using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using RainbowMage.OverlayPlugin;
using PartyOverlayPlugin.Memory;
using PartyOverlayPlugin.Models;

namespace PartyOverlayPlugin
{
    public class PartyOverlayEventSource : EventSourceBase
    {
        private const string PartyUpdateEvent = "onPartyOverlayUpdate";
        private const string CrossRealmEvent = "onCrossRealmPartyChanged";

        private CrossRealmPartyMemory partyMemory;
        private string lastPartySignature = string.Empty;
        private string statusFilePath;

        public PartyOverlayEventSource(TinyIoCContainer container) : base(container)
        {
            Name = "PartyOverlayES";

            // Cached event types: an overlay that connects (or reloads) after we already dispatched
            // gets the last known state immediately on subscribe instead of waiting for a change.
            RegisterCachedEventTypes(new List<string>
            {
                PartyUpdateEvent,
                CrossRealmEvent
            });

            RegisterEventHandler("getPartyOverlayData", (msg) =>
            {
                var state = GetState();
                return JObject.FromObject(state);
            });

            RegisterEventHandler("scanPartyMemory", (msg) =>
            {
                bool success = partyMemory?.ScanSignatures() ?? false;
                return new JObject
                {
                    ["success"] = success,
                    ["diagnostic"] = partyMemory?.LastDiagnosticStatus ?? "No memory reader"
                };
            });
        }

        public override Control CreateConfigControl()
        {
            return new UserControl();
        }

        public override void LoadConfig(IPluginConfig config)
        {
        }

        public override void SaveConfig(IPluginConfig config)
        {
        }

        public override void Start()
        {
            try
            {
                partyMemory = new CrossRealmPartyMemory(container);
            }
            catch (Exception ex)
            {
                Log(LogLevel.Error, $"Failed to initialize CrossRealmPartyMemory: {ex}");
            }

            // EventSourceBase's own timer drives Update() once per second (with overlap protection).
            base.Start();

            Log(LogLevel.Info, "PartyOverlayEventSource started.");
        }

        public override void Stop()
        {
            base.Stop();
            Log(LogLevel.Info, "PartyOverlayEventSource stopped.");
        }

        protected override void Update()
        {
            if (partyMemory == null) return;

            var state = GetState();
            var signature = BuildSignature(state);
            if (signature == lastPartySignature) return;
            lastPartySignature = signature;

            WriteStatusLine(state);

            DispatchAndCacheEvent(new JObject
            {
                ["type"] = PartyUpdateEvent,
                ["detail"] = JObject.FromObject(state)
            });

            var crossRealmEvent = new JObject
            {
                ["type"] = CrossRealmEvent,
                ["detail"] = JObject.FromObject(state)
            };

            // Keep the cached copy in sync even when the party stopped being cross-world, otherwise
            // a later subscriber would be handed a stale cross-realm party on connect.
            eventCache[CrossRealmEvent] = crossRealmEvent;

            if (state.IsCrossRealm)
            {
                DispatchEvent(crossRealmEvent);
            }
        }

        private PartyStateData GetState()
        {
            if (partyMemory == null)
            {
                return new PartyStateData { Diagnostic = "No memory reader" };
            }

            try
            {
                return partyMemory.GetCurrentPartyState();
            }
            catch (Exception ex)
            {
                Log(LogLevel.Debug, $"GetCurrentPartyState error: {ex.Message}");
                return new PartyStateData { Diagnostic = $"讀取失敗: {ex.Message}" };
            }
        }

        /// <summary>
        /// Mirrors the state line into a file next to the plugin.
        ///
        /// OverlayPlugin's logger keeps everything in memory for its log tab only, and in Release
        /// builds it discards Debug/Trace entirely, so there is otherwise no way to see why the
        /// overlay is showing what it shows. Only written when the state actually changes.
        /// </summary>
        private void WriteStatusLine(PartyStateData state)
        {
            try
            {
                var path = statusFilePath ?? (statusFilePath = ResolveStatusFilePath());
                if (string.IsNullOrEmpty(path)) return;

                // Keep it from growing without bound across long sessions.
                if (File.Exists(path) && new FileInfo(path).Length > 256 * 1024)
                    File.Delete(path);

                var line = string.Format("{0:yyyy-MM-dd HH:mm:ss}  source={1} type={2} members={3} crossRealm={4} leader={5}{6}    {7}{6}",
                    DateTime.Now, state.Source, state.PartyType, state.Members.Count, state.IsCrossRealm,
                    state.LeaderIndex, Environment.NewLine, state.Diagnostic);

                foreach (var member in state.Members)
                {
                    line += string.Format("      g{0} i{1} {2} lv{3} {4}/{5} home={6}({7}) cur={8}({9}) zone={10} leader={11}{12}",
                        member.GroupIndex, member.MemberIndex, member.Name, member.Level, member.JobName,
                        member.JobRole, member.HomeWorldName, member.HomeWorldId,
                        member.CurrentWorldName, member.CurrentWorldId, member.InCurrentZone,
                        member.IsLeader, Environment.NewLine);
                }

                File.AppendAllText(path, line, Encoding.UTF8);
            }
            catch (Exception)
            {
                // Diagnostics must never break the overlay.
            }
        }

        private static string ResolveStatusFilePath()
        {
            const string fileName = "PartyOverlay.status.log";

            try
            {
                var pluginPath = PartyOverlayAddon.PluginPath;
                if (!string.IsNullOrEmpty(pluginPath))
                {
                    var dir = Path.GetDirectoryName(pluginPath);
                    if (!string.IsNullOrEmpty(dir))
                        return Path.Combine(dir, fileName);
                }

                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Advanced Combat Tracker", "Config", fileName);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Composition/status signature used to detect real changes. HP/MP and the timestamp are
        /// left out on purpose - including them would push an event every single tick in combat.
        /// </summary>
        private static string BuildSignature(PartyStateData state)
        {
            var sb = new StringBuilder();
            sb.Append(state.PartyType).Append('|')
              .Append(state.PartyId).Append('|')
              .Append(state.LeaderIndex).Append('|')
              .Append(state.IsCrossRealm).Append('|')
              .Append(state.Diagnostic).Append("||");

            foreach (var member in state.Members)
            {
                sb.Append(member.Name).Append(':')
                  .Append(member.JobId).Append(':')
                  .Append(member.Level).Append(':')
                  .Append(member.HomeWorldId).Append(':')
                  .Append(member.CurrentWorldId).Append(':')
                  .Append(member.GroupIndex).Append(':')
                  .Append(member.IsLeader ? 1 : 0).Append(':')
                  .Append(member.InCurrentZone ? 1 : 0).Append(';');
            }

            return sb.ToString();
        }
    }
}
