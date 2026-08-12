using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using FFXIV_ACT_Plugin.Common;
using RainbowMage.OverlayPlugin;
using RainbowMage.OverlayPlugin.MemoryProcessors;
using RainbowMage.OverlayPlugin.MemoryProcessors.Combatant;
using RainbowMage.OverlayPlugin.MemoryProcessors.Party;
using PartyOverlayPlugin.Models;

namespace PartyOverlayPlugin.Memory
{
    /// <summary>
    /// Produces the overlay's party state from two sources:
    ///
    /// 1. <see cref="CrossRealmProxyMemory"/> reads InfoProxyCrossRealm, which holds the *complete*
    ///    cross-world roster - including members that are not loaded in our zone. This is the source
    ///    the game's own party list HUD uses for cross-world parties.
    /// 2. OverlayPlugin's <see cref="IPartyMemory"/> (GroupManager) for normal parties and alliances.
    ///    It only contains members present in our zone, but it does carry HP/MP, so we also use it to
    ///    enrich the cross-realm roster.
    /// </summary>
    public class CrossRealmPartyMemory
    {
        private const int MaxPartyMembers = 8;

        private readonly TinyIoCContainer container;
        private ILogger logger;

        private FFXIVMemory memory;
        private FFXIVRepository repository;
        private IPartyMemory partyMemory;
        private ICombatantMemory combatantMemory;
        private CrossRealmProxyMemory crossRealmProxy;

        private bool worldNamesLoaded;
        private bool worldOverridesLoaded;
        private bool partyChangeRegistered;
        private bool processChangeRegistered;
        private int lastKnownPartySize;

        public event Action OnPartyStateChanged;

        public string LastDiagnosticStatus { get; private set; } = "尚未初始化 (not initialized)";

        public CrossRealmPartyMemory(TinyIoCContainer container)
        {
            this.container = container;

            try
            {
                logger = container.Resolve<ILogger>();
            }
            catch (Exception)
            {
                // Logging is optional; everything below degrades gracefully without it.
            }
        }

        /// <summary>
        /// Re-resolves the party pointers and forces a fresh search for InfoProxyCrossRealm.
        /// </summary>
        public bool ScanSignatures()
        {
            if (!EnsureDependencies())
                return false;

            if (!memory.IsValid())
            {
                LastDiagnosticStatus = "尚未附加到 ffxiv_dx11 進程 (FFXIV process not attached)";
                return false;
            }

            crossRealmProxy.Reset();

            try
            {
                partyMemory.ScanPointers();
            }
            catch (Exception ex)
            {
                LastDiagnosticStatus = $"ScanPointers 失敗: {ex.Message}";
                logger?.Log(LogLevel.Debug, LastDiagnosticStatus);
                return false;
            }

            // Locating the proxy needs our own party entry to exist in it, so this only succeeds
            // while actually in a cross-world party. Report either way.
            var info = crossRealmProxy.TryRead(GetSelfContentId(), SafePlayerName(), true);
            LastDiagnosticStatus = crossRealmProxy.IsLocated
                ? $"OK - {crossRealmProxy.LastStatus}"
                : $"GroupManager={(partyMemory.IsValid() ? "OK" : "NG")}, CrossRealm={crossRealmProxy.LastStatus}";
            logger?.Log(LogLevel.Info, "PartyOverlay: {0}", LastDiagnosticStatus);

            return crossRealmProxy.IsLocated || info != null || partyMemory.IsValid();
        }

        public PartyStateData GetCurrentPartyState()
        {
            var result = new PartyStateData();

            if (!EnsureDependencies())
            {
                result.Diagnostic = LastDiagnosticStatus;
                return result;
            }

            if (!repository.IsFFXIVPluginPresent())
            {
                LastDiagnosticStatus = "FFXIV_ACT_Plugin 未載入 (FFXIV_ACT_Plugin not present)";
                result.Diagnostic = LastDiagnosticStatus;
                return result;
            }

            if (!memory.IsValid())
            {
                LastDiagnosticStatus = "尚未附加到 ffxiv_dx11 進程 (FFXIV process not attached)";
                result.Diagnostic = LastDiagnosticStatus;
                return result;
            }

            EnsureWorldNames();

            string groupManagerStatus;
            var lists = TryReadPartyLists(out groupManagerStatus);

            if (lists != null && (int)lists.memberCount != lastKnownPartySize)
            {
                lastKnownPartySize = (int)lists.memberCount;
                crossRealmProxy?.NotifyPartyChanged();
                OnPartyStateChanged?.Invoke();
            }

            var self = TryGetSelfCombatant();
            uint selfId = self?.ID ?? SafePlayerId();
            ushort selfHomeWorld = self?.WorldID ?? 0;
            ushort selfCurrentWorld = self?.CurrentWorldID ?? 0;

            var mainMembers = lists == null
                ? new List<PartyListEntry>()
                : CollectEntries(lists.partyMembers, Math.Min((int)lists.memberCount, MaxPartyMembers));

            ushort selfTerritory = 0;
            ulong selfContentId = 0;
            foreach (var entry in mainMembers)
            {
                if (entry.objectId != 0 && entry.objectId == selfId)
                {
                    selfTerritory = entry.territoryType;
                    selfContentId = (ulong)entry.contentId;
                    break;
                }
            }
            if (selfTerritory == 0 && mainMembers.Count > 0)
                selfTerritory = mainMembers[0].territoryType;

            // ---- 1. Cross-world party: InfoProxyCrossRealm ------------------------------------
            // Deliberately unconditional. Gating this on "are we in a party" was wrong: measured on
            // the TC client, a cross-world party whose other members are not loaded in our zone
            // leaves GroupManager completely EMPTY and FFXIV_ACT_Plugin's PartyListChanged does not
            // report them either - which is exactly the case this proxy exists for. Any party-state
            // gate therefore blocks the one situation we need. The search costs ~160 ms and backs off
            // to one attempt per minute, and it stops entirely once the proxy has been located.
            var crossRealm = crossRealmProxy.TryRead(selfContentId, SafePlayerName(), allowLocate: true);

            if (crossRealm != null && crossRealm.Members.Count > 0)
            {
                return BuildFromCrossRealm(crossRealm, lists, selfHomeWorld, selfId, selfContentId);
            }

            // ---- 2. Normal party / alliance: GroupManager -------------------------------------
            if (lists == null)
            {
                LastDiagnosticStatus = $"{groupManagerStatus}; CrossRealm: {crossRealmProxy.LastStatus}";
                result.Diagnostic = LastDiagnosticStatus;
                return result;
            }

            if (mainMembers.Count == 0)
            {
                // GroupManager is empty while solo. Mirror what OverlayPlugin's own party event does
                // and report ourselves as a one man party instead of "no data".
                if (self == null)
                {
                    LastDiagnosticStatus = "組隊資料為空，且讀不到本人角色 (no party, no self combatant)";
                    result.Diagnostic = LastDiagnosticStatus;
                    return result;
                }

                var (soloJobName, soloJobRole) = WorldJobData.GetJobInfo(self.Job);
                result.Source = "SelfCombatant";
                result.PartyType = PartyType.Solo.ToString();
                result.MemberCount = 1;
                result.LeaderIndex = 0;
                result.Members.Add(new PartyMemberData
                {
                    Name = self.Name ?? string.Empty,
                    ObjectId = self.ID,
                    HomeWorldId = self.WorldID,
                    HomeWorldName = WorldJobData.GetWorldName(self.WorldID),
                    CurrentWorldId = self.CurrentWorldID,
                    CurrentWorldName = WorldJobData.GetWorldName(self.CurrentWorldID),
                    JobId = self.Job,
                    JobName = soloJobName,
                    JobRole = soloJobRole,
                    Level = self.Level,
                    MemberIndex = 0,
                    GroupIndex = 0,
                    IsLeader = true,
                    IsCrossRealm = false,
                    InCurrentZone = true,
                    CurrentHP = (uint)Math.Max(0, self.CurrentHP),
                    MaxHP = (uint)Math.Max(0, self.MaxHP),
                    CurrentMP = (ushort)Math.Max(0, Math.Min(ushort.MaxValue, self.CurrentMP)),
                    MaxMP = (ushort)Math.Max(0, Math.Min(ushort.MaxValue, self.MaxMP))
                });

                LastDiagnosticStatus = $"OK - solo (region={GetRegionName()})";
                result.Diagnostic = LastDiagnosticStatus;
                return result;
            }

            bool isAlliance = (lists.allianceFlags & 0x01) != 0;
            int leaderIndex = (int)lists.partyLeaderIndex;

            result.Source = "GroupManager";
            AddMembers(result, mainMembers, 0, leaderIndex, selfHomeWorld, selfCurrentWorld, selfTerritory);

            if (isAlliance)
            {
                AddMembers(result, CollectEntries(lists.alliance1Members), 1, -1, selfHomeWorld, selfCurrentWorld, selfTerritory);
                AddMembers(result, CollectEntries(lists.alliance2Members), 2, -1, selfHomeWorld, selfCurrentWorld, selfTerritory);
                AddMembers(result, CollectEntries(lists.alliance3Members), 3, -1, selfHomeWorld, selfCurrentWorld, selfTerritory);
                AddMembers(result, CollectEntries(lists.alliance4Members), 4, -1, selfHomeWorld, selfCurrentWorld, selfTerritory);
                AddMembers(result, CollectEntries(lists.alliance5Members), 5, -1, selfHomeWorld, selfCurrentWorld, selfTerritory);
            }

            bool isCrossRealm = false;
            foreach (var member in result.Members)
            {
                if (member.IsCrossRealm)
                {
                    isCrossRealm = true;
                    break;
                }
            }

            result.PartyId = lists.partyId.ToString();
            result.LeaderIndex = leaderIndex;
            result.MemberCount = result.Members.Count;
            result.IsCrossRealm = isCrossRealm;

            if (isAlliance)
                result.PartyType = PartyType.Alliance.ToString();
            else if (isCrossRealm)
                result.PartyType = PartyType.CrossRealmParty.ToString();
            else if (result.Members.Count <= 1)
                result.PartyType = PartyType.Solo.ToString();
            else
                result.PartyType = PartyType.StandardParty.ToString();

            LastDiagnosticStatus =
                $"OK - GroupManager {result.PartyType} party={mainMembers.Count} total={result.Members.Count} " +
                $"allianceFlags=0x{lists.allianceFlags:X2} region={GetRegionName()} " +
                $"world={(selfHomeWorld == 0 ? "?" : WorldJobData.GetWorldName(selfHomeWorld))}; " +
                $"CrossRealm: {crossRealmProxy.LastStatus}";
            result.Diagnostic = LastDiagnosticStatus;

            return result;
        }

        /// <summary>
        /// Builds the party state from the cross-realm proxy, filling in HP/MP for the members that
        /// GroupManager also knows about (i.e. the ones loaded in our zone).
        /// </summary>
        private PartyStateData BuildFromCrossRealm(CrossRealmPartyInfo info, PartyListsStruct lists,
            ushort selfHomeWorld, uint selfObjectId, ulong selfContentId)
        {
            var localByContentId = new Dictionary<ulong, PartyListEntry>();
            if (lists != null)
            {
                AddToLookup(localByContentId, lists.partyMembers);
                AddToLookup(localByContentId, lists.alliance1Members);
                AddToLookup(localByContentId, lists.alliance2Members);
                AddToLookup(localByContentId, lists.alliance3Members);
                AddToLookup(localByContentId, lists.alliance4Members);
                AddToLookup(localByContentId, lists.alliance5Members);
            }

            // Prefer what the group array itself says over the header byte: the group data is what we
            // validated, the header is informational.
            bool isAlliance = info.NonEmptyGroupCount > 1 || info.IsInAllianceRaid;

            var data = new PartyStateData
            {
                Source = "InfoProxyCrossRealm",
                IsCrossRealm = true,
                PartyType = (isAlliance ? PartyType.Alliance : PartyType.CrossRealmParty).ToString(),
                MemberCount = info.Members.Count
            };

            int leaderIndex = -1;

            foreach (var member in info.Members)
            {
                var (jobName, jobRole) = WorldJobData.GetJobInfo(member.ClassJobId);
                bool crossWorld = selfHomeWorld != 0 && member.HomeWorld != 0 && member.HomeWorld != selfHomeWorld;

                PartyListEntry local = null;
                bool inCurrentZone = member.ContentId != 0 && localByContentId.TryGetValue(member.ContentId, out local);
                if (!inCurrentZone)
                    local = null;

                // We are trivially in our own zone. GroupManager can be completely empty in a
                // cross-world party, so without this the overlay would tag the local player as
                // "elsewhere" too.
                bool isSelf = (selfObjectId != 0 && member.ObjectId == selfObjectId) ||
                              (selfContentId != 0 && member.ContentId == selfContentId);
                if (isSelf)
                    inCurrentZone = true;

                if (member.IsPartyLeader && member.GroupIndex == 0)
                    leaderIndex = data.Members.Count;

                data.Members.Add(new PartyMemberData
                {
                    Name = member.Name ?? string.Empty,
                    ContentId = member.ContentId.ToString(),
                    ObjectId = member.ObjectId,
                    HomeWorldId = member.HomeWorld,
                    HomeWorldName = WorldJobData.GetWorldName(member.HomeWorld),
                    CurrentWorldId = member.CurrentWorld,
                    CurrentWorldName = WorldJobData.GetWorldName(member.CurrentWorld),
                    JobId = member.ClassJobId,
                    JobName = jobName,
                    JobRole = jobRole,
                    Level = member.Level,
                    MemberIndex = member.MemberIndex,
                    GroupIndex = member.GroupIndex,
                    TerritoryType = local?.territoryType ?? 0,
                    IsLeader = member.IsPartyLeader,
                    IsCrossRealm = crossWorld,
                    InCurrentZone = inCurrentZone,
                    CurrentHP = local?.currentHP ?? 0,
                    MaxHP = local?.maxHP ?? 0,
                    CurrentMP = local?.currentMP ?? 0,
                    MaxMP = local?.maxMP ?? 0
                });
            }

            data.LeaderIndex = leaderIndex >= 0 ? leaderIndex : 0;

            LastDiagnosticStatus =
                $"OK - {crossRealmProxy.LastStatus}; located via {crossRealmProxy.LocationStatus}; " +
                $"header(groupCount={info.GroupCount}, localGroup={info.LocalPlayerGroupIndex}, " +
                $"allianceRaid={info.IsInAllianceRaid}, inCrossRealmParty={info.IsInCrossRealmParty}), " +
                $"region={GetRegionName()}, groupManager={(lists?.partyMembers?.Length.ToString() ?? "n/a")}";
            data.Diagnostic = LastDiagnosticStatus;

            return data;
        }

        private static void AddToLookup(Dictionary<ulong, PartyListEntry> lookup, PartyListEntry[] entries)
        {
            if (entries == null) return;

            foreach (var entry in entries)
            {
                if (entry == null || entry.contentId == 0) continue;
                lookup[(ulong)entry.contentId] = entry;
            }
        }

        /// <summary>
        /// OverlayPlugin registers its memory processors in its second init phase (after ACT has
        /// loaded every plugin), so resolving them can fail for a while after startup. Gate on the
        /// interface registration: resolving concrete classes like FFXIVMemory too early would make
        /// TinyIoC happily construct a throwaway duplicate that never receives the FFXIV process.
        /// </summary>
        private bool EnsureDependencies()
        {
            if (repository != null && memory != null && partyMemory != null && crossRealmProxy != null)
                return true;

            if (!container.CanResolve<IPartyMemory>())
            {
                LastDiagnosticStatus = "OverlayPlugin 記憶體模組尚未就緒 (waiting for OverlayPlugin init phase 2)";
                return false;
            }

            try
            {
                repository = container.Resolve<FFXIVRepository>();
                memory = container.Resolve<FFXIVMemory>();
                partyMemory = container.Resolve<IPartyMemory>();

                if (container.CanResolve<ICombatantMemory>())
                    combatantMemory = container.Resolve<ICombatantMemory>();

                crossRealmProxy = new CrossRealmProxyMemory(memory, repository, logger);
                RegisterPartyChangeHandler();
                RegisterProcessChangeHandler();
                return true;
            }
            catch (Exception ex)
            {
                repository = null;
                memory = null;
                partyMemory = null;
                crossRealmProxy = null;
                LastDiagnosticStatus = $"無法取得 OverlayPlugin 服務: {ex.Message}";
                logger?.Log(LogLevel.Debug, LastDiagnosticStatus);
                return false;
            }
        }

        /// <summary>
        /// FFXIV_ACT_Plugin's party list tells us cheaply whether a party exists at all, which gates
        /// the (comparatively expensive) memory search for InfoProxyCrossRealm.
        /// </summary>
        private void RegisterPartyChangeHandler()
        {
            if (partyChangeRegistered) return;

            try
            {
                repository.RegisterPartyChangeDelegate(OnPartyChanged);
                partyChangeRegistered = true;
            }
            catch (Exception ex)
            {
                logger?.Log(LogLevel.Debug, "PartyOverlay: could not hook PartyListChanged: {0}", ex.Message);
            }
        }

        /// <summary>
        /// The proxy reader needs the game process id to query memory regions. This event also fires
        /// immediately with the current process, so there is nothing to poll.
        /// </summary>
        private void RegisterProcessChangeHandler()
        {
            if (processChangeRegistered) return;

            try
            {
                repository.RegisterProcessChangedHandler(process => crossRealmProxy?.SetProcess(process));
                processChangeRegistered = true;
            }
            catch (Exception ex)
            {
                logger?.Log(LogLevel.Debug, "PartyOverlay: could not hook ProcessChanged: {0}", ex.Message);
            }
        }

        private void OnPartyChanged(ReadOnlyCollection<uint> partyList, int partySize)
        {
            lastKnownPartySize = partySize;
            // The cross-realm proxy may have just become populated - look again without waiting for
            // the accumulated back off.
            crossRealmProxy?.NotifyPartyChanged();
            OnPartyStateChanged?.Invoke();
        }

        private PartyListsStruct TryReadPartyLists(out string status)
        {
            try
            {
                if (!partyMemory.IsValid())
                {
                    partyMemory.ScanPointers();
                    if (!partyMemory.IsValid())
                    {
                        status = $"找不到 GroupManager (region={GetRegionName()})";
                        return null;
                    }
                }

                var lists = partyMemory.GetPartyLists();

                // A readable GroupManager always yields arrays (possibly empty). Null arrays mean the
                // instance address itself never resolved, which is a different problem from "solo".
                if (lists.partyMembers == null)
                {
                    status = $"讀不到 GroupManager，FFXIV_ACT_Plugin 簽章未解析 (region={GetRegionName()})";
                    return null;
                }

                status = "OK";
                return lists;
            }
            catch (Exception ex)
            {
                status = $"GetPartyLists 失敗: {ex.Message}";
                logger?.Log(LogLevel.Debug, "PartyOverlay: {0}", status);
                return null;
            }
        }

        private void AddMembers(PartyStateData result, List<PartyListEntry> entries, int groupIndex,
            int leaderIndex, ushort selfHomeWorld, ushort selfCurrentWorld, ushort selfTerritory)
        {
            for (int i = 0; i < entries.Count; i++)
            {
                var entry = entries[i];
                var (jobName, jobRole) = WorldJobData.GetJobInfo(entry.classJob);

                bool crossWorld = selfHomeWorld != 0 && entry.homeWorld != 0 && entry.homeWorld != selfHomeWorld;
                bool inCurrentZone = selfTerritory != 0 && entry.territoryType == selfTerritory;
                // Everyone standing in our zone is on the same world instance as us; for members
                // that are still elsewhere the current world is simply unknown.
                ushort currentWorld = inCurrentZone && selfCurrentWorld != 0 ? selfCurrentWorld : (ushort)0;

                result.Members.Add(new PartyMemberData
                {
                    Name = entry.name ?? string.Empty,
                    ContentId = entry.contentId.ToString(),
                    ObjectId = entry.objectId,
                    HomeWorldId = entry.homeWorld,
                    HomeWorldName = WorldJobData.GetWorldName(entry.homeWorld),
                    CurrentWorldId = currentWorld,
                    CurrentWorldName = WorldJobData.GetWorldName(currentWorld),
                    JobId = entry.classJob,
                    JobName = jobName,
                    JobRole = jobRole,
                    Level = entry.level,
                    MemberIndex = i,
                    GroupIndex = groupIndex,
                    TerritoryType = entry.territoryType,
                    IsLeader = groupIndex == 0 && i == leaderIndex,
                    IsCrossRealm = crossWorld,
                    InCurrentZone = inCurrentZone,
                    CurrentHP = entry.currentHP,
                    MaxHP = entry.maxHP,
                    CurrentMP = entry.currentMP,
                    MaxMP = entry.maxMP
                });
            }
        }

        /// <summary>
        /// Alliance arrays are fixed size with holes, the party array is packed but may contain
        /// stale trailing entries; filter both down to real members.
        /// </summary>
        private List<PartyListEntry> CollectEntries(PartyListEntry[] entries, int count = -1)
        {
            var list = new List<PartyListEntry>();
            if (entries == null) return list;

            int limit = count < 0 ? entries.Length : Math.Min(count, entries.Length);
            for (int i = 0; i < limit; i++)
            {
                var entry = entries[i];
                if (entry == null) continue;
                if (string.IsNullOrEmpty(entry.name)) continue;
                list.Add(entry);
            }

            return list;
        }

        private Combatant TryGetSelfCombatant()
        {
            if (combatantMemory == null) return null;

            try
            {
                if (!combatantMemory.IsValid()) return null;
                return combatantMemory.GetSelfCombatant();
            }
            catch (Exception ex)
            {
                logger?.Log(LogLevel.Debug, "PartyOverlay: GetSelfCombatant failed: {0}", ex.Message);
                return null;
            }
        }

        /// <summary>
        /// Our own content id, used as the primary anchor when searching for InfoProxyCrossRealm.
        /// </summary>
        private ulong GetSelfContentId()
        {
            try
            {
                if (!partyMemory.IsValid()) return 0;

                var lists = partyMemory.GetPartyLists();
                if (lists.partyMembers == null) return 0;

                uint selfId = SafePlayerId();
                foreach (var entry in lists.partyMembers)
                {
                    if (entry != null && entry.objectId != 0 && entry.objectId == selfId)
                        return (ulong)entry.contentId;
                }
            }
            catch (Exception)
            {
            }

            return 0;
        }

        private uint SafePlayerId()
        {
            try
            {
                return repository.GetPlayerID();
            }
            catch (Exception)
            {
                return 0;
            }
        }

        private string SafePlayerName()
        {
            try
            {
                return repository.GetPlayerName();
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// World names come from FFXIV_ACT_Plugin's world list so every region (incl. TC) resolves
        /// without us maintaining a hardcoded id table. Retried until the resource is available.
        /// </summary>
        private void EnsureWorldNames()
        {
            if (worldNamesLoaded) return;

            LoadWorldNameOverrides();

            try
            {
                var worlds = repository.GetResourceDictionary(ResourceType.WorldList_EN);
                if (worlds != null && worlds.Count > 0)
                {
                    WorldJobData.SetWorldNames(worlds);
                    worldNamesLoaded = true;
                    logger?.Log(LogLevel.Debug, "PartyOverlay: loaded {0} world names.", worlds.Count);
                }
            }
            catch (Exception ex)
            {
                logger?.Log(LogLevel.Debug, "PartyOverlay: could not load world list: {0}", ex.Message);
            }
        }

        /// <summary>
        /// Optional user supplied world names, for ids that FFXIV_ACT_Plugin's world list doesn't
        /// cover (it has no TC 4xxx entries). Plain JSON, e.g. {"4034": "世界名"}.
        /// Looked for next to the plugin dll and in ACT's config directory.
        /// </summary>
        private void LoadWorldNameOverrides()
        {
            if (worldOverridesLoaded) return;
            worldOverridesLoaded = true;

            foreach (var path in GetWorldOverridePaths())
            {
                try
                {
                    if (string.IsNullOrEmpty(path) || !System.IO.File.Exists(path))
                        continue;

                    var raw = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, string>>(
                        System.IO.File.ReadAllText(path));
                    if (raw == null) continue;

                    var parsed = new Dictionary<ushort, string>();
                    foreach (var pair in raw)
                    {
                        ushort id;
                        if (ushort.TryParse(pair.Key, out id) && !string.IsNullOrEmpty(pair.Value))
                            parsed[id] = pair.Value;
                    }

                    if (parsed.Count > 0)
                    {
                        WorldJobData.SetWorldNameOverrides(parsed);
                        logger?.Log(LogLevel.Info, "PartyOverlay: loaded {0} world name override(s) from {1}.",
                            parsed.Count, path);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    logger?.Log(LogLevel.Error, "PartyOverlay: could not read world overrides from {0}: {1}", path, ex.Message);
                }
            }
        }

        private IEnumerable<string> GetWorldOverridePaths()
        {
            const string fileName = "PartyOverlay.worlds.json";

            var pluginPath = PartyOverlayAddon.PluginPath;
            if (!string.IsNullOrEmpty(pluginPath))
            {
                var dir = System.IO.Path.GetDirectoryName(pluginPath);
                if (!string.IsNullOrEmpty(dir))
                    yield return System.IO.Path.Combine(dir, fileName);
            }

            yield return System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Advanced Combat Tracker", "Config", fileName);
        }

        private string GetRegionName()
        {
            try
            {
                return repository.GetMachinaRegion().ToString();
            }
            catch (Exception)
            {
                return "unknown";
            }
        }
    }
}
