using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using RainbowMage.OverlayPlugin;
using RainbowMage.OverlayPlugin.MemoryProcessors;

namespace PartyOverlayPlugin.Memory
{
    public class CrossRealmMemberInfo
    {
        public ulong ContentId;
        public uint ObjectId;
        public byte Level;
        public ushort HomeWorld;
        public ushort CurrentWorld;
        public byte ClassJobId;
        public string Name = string.Empty;
        public byte MemberIndex;
        public byte GroupIndex;
        public bool IsPartyLeader;
    }

    public class CrossRealmPartyInfo
    {
        public byte GroupCount;
        public int NonEmptyGroupCount;
        public byte LocalPlayerGroupIndex;
        public bool IsCrossRealm;
        public bool IsInAllianceRaid;
        public bool IsLocalPlayerLeader;
        public bool IsInCrossRealmParty;
        public List<CrossRealmMemberInfo> Members = new List<CrossRealmMemberInfo>();
    }

    /// <summary>
    /// Reads <c>Client::UI::Info::InfoProxyCrossRealm</c> out of the game process.
    ///
    /// Why this exists: GroupManager (what OverlayPlugin's IPartyMemory exposes) only ever contains
    /// party members that are loaded in *our* zone. In a cross-world party the remaining members
    /// only exist in InfoProxyCrossRealm, which is also what the game's own party list HUD reads.
    ///
    /// How the instance is found - measured on the live TC client (ffxiv_dx11, 4.7 GB working set):
    ///
    ///   * On 7.x the proxy is heap allocated and the image only holds a *pointer* to it
    ///     (FFXIVClientStructs data.yml marks the instance `pointer: true` from 7.0 onwards; in 6.4
    ///     the object was embedded in .data). Scanning the 4.4 GB of committed private memory for it
    ///     takes ~21 s, which is not viable. But the writable image sections are only 6.9 MB and
    ///     contain a mere ~1900 qwords that even look like heap pointers, so we scan *those slots*
    ///     instead: dereference each, then test whether the target is a valid cross-realm proxy.
    ///     That takes tens of milliseconds.
    ///   * On 6.x the object sits in .data itself, so we additionally look for our own party entry
    ///     directly in the writable sections and walk back to the group array.
    ///
    /// Either way the candidate is validated structurally: every group's member count must be in
    /// range and every member's own MemberIndex/GroupIndex/ClassJob/Level must agree with the slot it
    /// physically occupies. That same check auto-detects which <see cref="CrossRealmLayout"/> and
    /// which group-array offset the client uses, so no patch level has to be hardcoded, and a wrong
    /// guess is rejected instead of rendered as garbage.
    ///
    /// We cache the *pointer slot*, not the object, so the reader keeps working if the game ever
    /// reallocates the proxy.
    /// </summary>
    public class CrossRealmProxyMemory
    {
        // Highest ClassJob id we consider plausible. Deliberately generous so a new job added in a
        // future patch doesn't make validation reject a perfectly good proxy.
        private const int MaxPlausibleJobId = 60;
        private const int MaxPlausibleLevel = 120;

        // Locating is only attempted while we're actually in a party. A local (non cross-world) party
        // leaves the proxy empty and therefore unidentifiable, so failed attempts back off instead of
        // repeating every few seconds for a whole raid night.
        private static readonly TimeSpan MinLocateInterval = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan MaxLocateInterval = TimeSpan.FromSeconds(60);
        private const long MaxImageScanBytes = 64L * 1024 * 1024;
        private const int ScanChunkSize = 0x100000;
        private const int MaxCandidateHits = 64;

        private readonly FFXIVMemory memory;
        private readonly FFXIVRepository repository;
        private readonly ILogger logger;
        private readonly object readLock = new object();

        // Located state. Either slotAddress (7.x: .data holds a pointer to the heap object) or
        // groupsAddress (6.x: object embedded in the image) is set.
        private IntPtr slotAddress = IntPtr.Zero;
        private int groupsOffset;
        private IntPtr groupsAddress = IntPtr.Zero;
        private CrossRealmLayout layout;

        private IntPtr locatedModuleBase = IntPtr.Zero;
        private IntPtr queryHandle = IntPtr.Zero;
        private int queryHandlePid;
        private int gameProcessId;
        private DateTime lastLocateAttempt = DateTime.MinValue;
        private TimeSpan locateInterval = MinLocateInterval;
        private bool forceLocate;

        public CrossRealmProxyMemory(FFXIVMemory memory, FFXIVRepository repository, ILogger logger)
        {
            this.memory = memory;
            this.repository = repository;
            this.logger = logger;
        }

        public bool IsLocated => slotAddress != IntPtr.Zero || groupsAddress != IntPtr.Zero;
        public string DetectedLayout => layout?.Name ?? "unknown";
        public string LastStatus { get; private set; } = "未搜尋 (not searched yet)";

        /// <summary>
        /// How the proxy was located. Kept separately from <see cref="LastStatus"/> so per-read status
        /// updates don't erase it - it is the part worth having in a bug report.
        /// </summary>
        public string LocationStatus { get; private set; } = "未定位 (not located)";

        /// <summary>Drops the cached address so the next read re-locates the proxy.</summary>
        public void Reset()
        {
            slotAddress = IntPtr.Zero;
            groupsAddress = IntPtr.Zero;
            groupsOffset = 0;
            layout = null;
            forceLocate = true;
            locateInterval = MinLocateInterval;
            LastStatus = "已要求重新搜尋 (rescan requested)";
            LocationStatus = "未定位 (not located)";
        }

        /// <summary>
        /// Called when the party composition changed: the proxy may have become populated, so drop
        /// the accumulated back off and look again promptly.
        /// </summary>
        public void NotifyPartyChanged()
        {
            locateInterval = MinLocateInterval;
            lastLocateAttempt = DateTime.MinValue;
        }

        /// <summary>
        /// Returns the cross-realm party, or null when the proxy isn't available (yet).
        /// An empty member list means the proxy was read fine but we're not in a cross-world party.
        /// </summary>
        /// <param name="selfContentId">Our own content id; used to confirm the right candidate.</param>
        /// <param name="selfName">Our character name; fallback confirmation / 6.x anchor.</param>
        /// <param name="allowLocate">False while we have no reason to believe we're in a party.</param>
        public CrossRealmPartyInfo TryRead(ulong selfContentId, string selfName, bool allowLocate)
        {
            // The event source timer and JS handler calls can arrive concurrently; serialize so two
            // threads never run the scan at the same time.
            lock (readLock)
            {
                return TryReadLocked(selfContentId, selfName, allowLocate);
            }
        }

        private CrossRealmPartyInfo TryReadLocked(ulong selfContentId, string selfName, bool allowLocate)
        {
            if (!memory.IsValid())
            {
                LastStatus = "尚未附加到 ffxiv_dx11 進程";
                return null;
            }

            // The client relocates on every launch, so anything cached from a previous game process
            // is meaningless even if it still happens to be readable.
            if (IsLocated && TryGetModuleBase() != locatedModuleBase)
            {
                slotAddress = IntPtr.Zero;
                groupsAddress = IntPtr.Zero;
                layout = null;
                locateInterval = MinLocateInterval;
                CloseQueryHandle();
            }

            if (IsLocated)
            {
                var groups = ResolveGroupsAddress();
                if (groups != IntPtr.Zero)
                {
                    var buffer = ReadBlock(groups, layout);
                    if (buffer != null && Validate(buffer, layout, requireMembers: false))
                        return Parse(buffer, layout, groups);
                }

                logger?.Log(LogLevel.Debug, "PartyOverlay: cached cross-realm location no longer valid, rescanning.");
                slotAddress = IntPtr.Zero;
                groupsAddress = IntPtr.Zero;
                layout = null;
            }

            if (!TryLocate(selfContentId, selfName, allowLocate))
                return null;

            var located = ResolveGroupsAddress();
            if (located == IntPtr.Zero)
                return null;

            var block = ReadBlock(located, layout);
            if (block == null || !Validate(block, layout, requireMembers: false))
                return null;

            return Parse(block, layout, located);
        }

        private IntPtr ResolveGroupsAddress()
        {
            if (slotAddress != IntPtr.Zero)
            {
                var obj = memory.ReadIntPtr(slotAddress);
                if (obj == IntPtr.Zero)
                    return IntPtr.Zero;
                return new IntPtr(obj.ToInt64() + groupsOffset);
            }

            return groupsAddress;
        }

        /// <summary>Reads the party header plus the whole group array in one go.</summary>
        private byte[] ReadBlock(IntPtr groups, CrossRealmLayout candidate)
        {
            if (candidate == null || groups.ToInt64() <= CrossRealmLayout.HeaderPrefix)
                return null;
            return memory.Read8(new IntPtr(groups.ToInt64() - CrossRealmLayout.HeaderPrefix), candidate.ReadSize);
        }

        #region Locating

        private bool TryLocate(ulong selfContentId, string selfName, bool allowLocate)
        {
            if (!allowLocate && !forceLocate)
            {
                LastStatus = "未在隊伍中，略過搜尋 (not in a party, scan skipped)";
                return false;
            }

            if (!forceLocate && DateTime.UtcNow - lastLocateAttempt < locateInterval)
                return false;

            lastLocateAttempt = DateTime.UtcNow;
            forceLocate = false;

            // Back off for the next attempt; a success or a party change resets this.
            var nextInterval = TimeSpan.FromTicks(locateInterval.Ticks * 2);
            locateInterval = nextInterval > MaxLocateInterval ? MaxLocateInterval : nextInterval;

            ImageInfo image;
            if (!TryGetImageInfo(out image))
            {
                LastStatus = "無法解析 PE 區段 (could not read PE section table)";
                return false;
            }

            var watch = Stopwatch.StartNew();

            // 7.x: the image holds a pointer to a heap allocated proxy.
            if (TryLocateViaPointerSlots(image, selfContentId, selfName, watch))
                return true;

            // 6.x: the proxy object is embedded in the image, so look for our own entry directly.
            if (TryLocateEmbedded(image, selfContentId, selfName, watch))
                return true;

            return false;
        }

        /// <summary>
        /// Scans the writable image sections for pointers into committed private memory, then tests
        /// each target as a cross-realm proxy. This is the 7.x path.
        /// </summary>
        private bool TryLocateViaPointerSlots(ImageInfo image, ulong selfContentId, string selfName, Stopwatch watch)
        {
            List<Range> heap;
            if (!TryGetHeapRanges(out heap))
            {
                LastStatus = "無法列舉行程記憶體區段 (VirtualQueryEx unavailable)";
                return false;
            }

            heap.Sort((a, b) => a.Start.ToInt64().CompareTo(b.Start.ToInt64()));

            var candidates = new List<IntPtr>();   // slot address in the image
            int inspected = 0;

            foreach (var section in image.WritableSections)
            {
                long position = 0;
                while (position < section.Size)
                {
                    int length = (int)Math.Min(ScanChunkSize, section.Size - position);
                    var buffer = memory.Read8(new IntPtr(section.Start.ToInt64() + position), length);
                    if (buffer != null)
                    {
                        for (int i = 0; i + 8 <= length; i += 8)
                        {
                            long value = BitConverter.ToInt64(buffer, i);
                            if (value <= 0x10000 || value >= 0x7FFFFFFFFFFF)
                                continue;
                            if (!ContainsAddress(heap, value))
                                continue;

                            inspected++;
                            candidates.Add(new IntPtr(section.Start.ToInt64() + position + i));
                        }
                    }
                    position += length;
                }
            }

            var confirmed = new List<Located>();

            foreach (var slot in candidates)
            {
                var obj = memory.ReadIntPtr(slot);
                if (obj == IntPtr.Zero)
                    continue;

                // Every InfoProxy is a C++ object, so its first qword is a vtable inside the module.
                // Cheap filter that throws out plain data buffers before the bigger reads.
                var vtable = memory.ReadIntPtr(obj);
                if (!image.ContainsReadOnly(vtable))
                    continue;

                foreach (var candidate in CrossRealmLayout.Candidates)
                {
                    if (candidate.InstanceEmbeddedInImage)
                        continue;

                    foreach (var offset in candidate.GroupsOffsets)
                    {
                        var groups = new IntPtr(obj.ToInt64() + offset);
                        var block = ReadBlock(groups, candidate);
                        if (block == null || !Validate(block, candidate, requireMembers: true))
                            continue;

                        confirmed.Add(new Located
                        {
                            Slot = slot,
                            GroupsOffset = offset,
                            Layout = candidate,
                            ContainsSelf = ContainsSelf(block, candidate, selfContentId, selfName)
                        });
                    }
                }
            }

            watch.Stop();

            if (confirmed.Count == 0)
            {
                LastStatus = $"掃描 {candidates.Count} 個指標候選 ({watch.ElapsedMilliseconds}ms)，" +
                             "未找到跨服隊伍資料（未在跨服小隊中？）";
                return false;
            }

            // Prefer a candidate that actually contains us; aliases would otherwise be a coin flip.
            Located best = confirmed[0];
            foreach (var item in confirmed)
            {
                if (item.ContainsSelf)
                {
                    best = item;
                    break;
                }
            }

            slotAddress = best.Slot;
            groupsOffset = best.GroupsOffset;
            groupsAddress = IntPtr.Zero;
            layout = best.Layout;
            locatedModuleBase = TryGetModuleBase();
            locateInterval = MinLocateInterval;

            LocationStatus = $"指標槽 @ 0x{best.Slot.ToInt64():X} (rva 0x{best.Slot.ToInt64() - locatedModuleBase.ToInt64():X}), " +
                             $"groups+0x{best.GroupsOffset:X}, layout {best.Layout.Name}, " +
                             $"self={(best.ContainsSelf ? "yes" : "no")}, {candidates.Count} 候選 / {watch.ElapsedMilliseconds}ms";
            LastStatus = LocationStatus;
            logger?.Log(LogLevel.Info, "PartyOverlay: found InfoProxyCrossRealm via {0}", LocationStatus);
            return true;
        }

        /// <summary>
        /// 6.x path: the proxy object lives in the image, so find our own party entry in the writable
        /// sections and walk back to the group array.
        /// </summary>
        private bool TryLocateEmbedded(ImageInfo image, ulong selfContentId, string selfName, Stopwatch watch)
        {
            byte[] contentIdNeedle = selfContentId != 0 ? BitConverter.GetBytes(selfContentId) : null;
            byte[] nameNeedle = null;
            if (!string.IsNullOrEmpty(selfName))
            {
                var nameBytes = Encoding.UTF8.GetBytes(selfName);
                nameNeedle = new byte[nameBytes.Length + 1];
                Array.Copy(nameBytes, nameNeedle, nameBytes.Length);
            }

            if (contentIdNeedle == null && nameNeedle == null)
                return false;

            foreach (var candidate in CrossRealmLayout.Candidates)
            {
                if (!candidate.InstanceEmbeddedInImage)
                    continue;

                if (contentIdNeedle != null &&
                    TryLocateEmbeddedWith(image, contentIdNeedle, candidate.ContentIdOffset, candidate))
                    return true;

                if (nameNeedle != null &&
                    TryLocateEmbeddedWith(image, nameNeedle, candidate.NameOffset, candidate))
                    return true;
            }

            return false;
        }

        private bool TryLocateEmbeddedWith(ImageInfo image, byte[] needle, int anchorOffset, CrossRealmLayout candidate)
        {
            foreach (var hit in FindBytes(image.WritableSections, needle))
            {
                var memberBase = new IntPtr(hit.ToInt64() - anchorOffset);

                var member = memory.Read8(memberBase, candidate.MemberSize);
                if (member == null)
                    continue;

                int memberIndex = member[candidate.MemberIndexOffset];
                int groupIndex = member[candidate.GroupIndexOffset];
                if (memberIndex >= candidate.MaxGroupMembers || groupIndex >= candidate.MaxGroups)
                    continue;

                long groupBase = memberBase.ToInt64() - candidate.GroupMembersOffset - ((long)memberIndex * candidate.MemberSize);
                long groups = groupBase - ((long)groupIndex * candidate.GroupSize);
                if (groups <= CrossRealmLayout.HeaderPrefix)
                    continue;

                var block = ReadBlock(new IntPtr(groups), candidate);
                if (block == null || !Validate(block, candidate, requireMembers: true))
                    continue;

                slotAddress = IntPtr.Zero;
                groupsAddress = new IntPtr(groups);
                groupsOffset = 0;
                layout = candidate;
                locatedModuleBase = TryGetModuleBase();
                locateInterval = MinLocateInterval;
                LocationStatus = $"影像內物件 @ 0x{groups:X}, layout {candidate.Name}";
                LastStatus = LocationStatus;
                logger?.Log(LogLevel.Info, "PartyOverlay: found InfoProxyCrossRealm ({0})", LocationStatus);
                return true;
            }

            return false;
        }

        private struct Located
        {
            public IntPtr Slot;
            public int GroupsOffset;
            public CrossRealmLayout Layout;
            public bool ContainsSelf;
        }

        private bool ContainsSelf(byte[] buffer, CrossRealmLayout candidate, ulong selfContentId, string selfName)
        {
            for (int group = 0; group < candidate.MaxGroups; group++)
            {
                int groupOffset = CrossRealmLayout.HeaderPrefix + (group * candidate.GroupSize);
                int count = buffer[groupOffset + candidate.GroupMemberCountOffset];

                for (int i = 0; i < count; i++)
                {
                    int offset = groupOffset + candidate.GroupMembersOffset + (i * candidate.MemberSize);

                    if (selfContentId != 0 &&
                        BitConverter.ToUInt64(buffer, offset + candidate.ContentIdOffset) == selfContentId)
                        return true;

                    if (!string.IsNullOrEmpty(selfName) &&
                        ReadString(buffer, offset + candidate.NameOffset, candidate.NameLength) == selfName)
                        return true;
                }
            }

            return false;
        }

        #endregion

        /// <summary>
        /// Structural self consistency check. Each member carries its own index and group index, so a
        /// correctly aligned group array has to agree with its own array positions everywhere.
        /// Note this deliberately does not test the party header: the group data is what we render,
        /// and the header bytes are informational only.
        /// </summary>
        private bool Validate(byte[] buffer, CrossRealmLayout candidate, bool requireMembers)
        {
            int totalMembers = 0;

            for (int group = 0; group < candidate.MaxGroups; group++)
            {
                int groupOffset = CrossRealmLayout.HeaderPrefix + (group * candidate.GroupSize);
                int count = buffer[groupOffset + candidate.GroupMemberCountOffset];
                if (count > candidate.MaxGroupMembers)
                    return false;

                for (int i = 0; i < count; i++)
                {
                    int offset = groupOffset + candidate.GroupMembersOffset + (i * candidate.MemberSize);

                    if (buffer[offset + candidate.MemberIndexOffset] != i)
                        return false;
                    if (buffer[offset + candidate.GroupIndexOffset] != group)
                        return false;
                    if (buffer[offset + candidate.ClassJobOffset] > MaxPlausibleJobId)
                        return false;

                    int level = buffer[offset + candidate.LevelOffset];
                    if (level == 0 || level > MaxPlausibleLevel)
                        return false;

                    if (buffer[offset + candidate.NameOffset] == 0)
                        return false;

                    totalMembers++;
                }
            }

            return !requireMembers || totalMembers > 0;
        }

        private CrossRealmPartyInfo Parse(byte[] buffer, CrossRealmLayout candidate, IntPtr groups)
        {
            var info = new CrossRealmPartyInfo
            {
                GroupCount = buffer[CrossRealmLayout.GroupCountOffset],
                LocalPlayerGroupIndex = buffer[CrossRealmLayout.LocalPlayerGroupIndexOffset],
                IsCrossRealm = buffer[CrossRealmLayout.IsCrossRealmOffset] != 0,
                IsInAllianceRaid = buffer[CrossRealmLayout.IsInAllianceRaidOffset] != 0,
                IsLocalPlayerLeader = buffer[CrossRealmLayout.IsPartyLeaderOffset] != 0,
                IsInCrossRealmParty = buffer[CrossRealmLayout.IsInCrossRealmPartyOffset] != 0
            };

            for (int group = 0; group < candidate.MaxGroups; group++)
            {
                int groupOffset = CrossRealmLayout.HeaderPrefix + (group * candidate.GroupSize);
                int count = buffer[groupOffset + candidate.GroupMemberCountOffset];
                if (count > 0)
                    info.NonEmptyGroupCount++;

                for (int i = 0; i < count; i++)
                {
                    int offset = groupOffset + candidate.GroupMembersOffset + (i * candidate.MemberSize);

                    info.Members.Add(new CrossRealmMemberInfo
                    {
                        ContentId = BitConverter.ToUInt64(buffer, offset + candidate.ContentIdOffset),
                        ObjectId = BitConverter.ToUInt32(buffer, offset + candidate.EntityIdOffset),
                        Level = buffer[offset + candidate.LevelOffset],
                        HomeWorld = BitConverter.ToUInt16(buffer, offset + candidate.HomeWorldOffset),
                        CurrentWorld = BitConverter.ToUInt16(buffer, offset + candidate.CurrentWorldOffset),
                        ClassJobId = buffer[offset + candidate.ClassJobOffset],
                        Name = ReadString(buffer, offset + candidate.NameOffset, candidate.NameLength),
                        MemberIndex = buffer[offset + candidate.MemberIndexOffset],
                        GroupIndex = buffer[offset + candidate.GroupIndexOffset],
                        IsPartyLeader = buffer[offset + candidate.IsPartyLeaderMemberOffset] != 0
                    });
                }
            }

            LastStatus = $"groups @ 0x{groups.ToInt64():X} (layout {candidate.Name}), " +
                         $"groups={info.NonEmptyGroupCount}, members={info.Members.Count}";
            return info;
        }

        #region Process / image inspection

        private struct Range
        {
            public IntPtr Start;
            public long Size;
        }

        private class ImageInfo
        {
            public IntPtr Base;
            public long Size;
            public List<Range> WritableSections = new List<Range>();

            /// <summary>True for addresses inside the module image but outside its writable sections
            /// (i.e. .text / .rdata, where vtables live).</summary>
            public bool ContainsReadOnly(IntPtr address)
            {
                long value = address.ToInt64();
                if (value < Base.ToInt64() || value >= Base.ToInt64() + Size)
                    return false;

                foreach (var section in WritableSections)
                {
                    long start = section.Start.ToInt64();
                    if (value >= start && value < start + section.Size)
                        return false;
                }

                return true;
            }
        }

        private IntPtr TryGetModuleBase()
        {
            try
            {
                return memory.GetBaseAddress();
            }
            catch (Exception)
            {
                return IntPtr.Zero;
            }
        }

        private bool TryGetImageInfo(out ImageInfo info)
        {
            info = null;

            IntPtr baseAddress = TryGetModuleBase();
            if (baseAddress == IntPtr.Zero)
                return false;

            var dosHeader = memory.Read8(baseAddress, 0x40);
            if (dosHeader == null || dosHeader[0] != 'M' || dosHeader[1] != 'Z')
                return false;

            int ntOffset = BitConverter.ToInt32(dosHeader, 0x3C);
            if (ntOffset <= 0 || ntOffset > 0x1000)
                return false;

            // PE signature (4) + IMAGE_FILE_HEADER (20) + start of the optional header
            var headers = memory.Read8(IntPtr.Add(baseAddress, ntOffset), 24 + 64);
            if (headers == null || headers[0] != 'P' || headers[1] != 'E')
                return false;

            int sectionCount = BitConverter.ToUInt16(headers, 4 + 2);
            int optionalHeaderSize = BitConverter.ToUInt16(headers, 4 + 16);
            if (sectionCount <= 0 || sectionCount > 96)
                return false;

            // IMAGE_OPTIONAL_HEADER64.SizeOfImage
            uint sizeOfImage = BitConverter.ToUInt32(headers, 24 + 56);

            var sectionTable = memory.Read8(IntPtr.Add(baseAddress, ntOffset + 24 + optionalHeaderSize), sectionCount * 40);
            if (sectionTable == null)
                return false;

            const uint IMAGE_SCN_MEM_WRITE = 0x80000000;

            info = new ImageInfo { Base = baseAddress, Size = sizeOfImage };
            long total = 0;

            for (int i = 0; i < sectionCount; i++)
            {
                int entry = i * 40;
                uint virtualSize = BitConverter.ToUInt32(sectionTable, entry + 8);
                uint virtualAddress = BitConverter.ToUInt32(sectionTable, entry + 12);
                uint characteristics = BitConverter.ToUInt32(sectionTable, entry + 36);

                if ((characteristics & IMAGE_SCN_MEM_WRITE) == 0)
                    continue;
                if (virtualSize == 0 || virtualAddress == 0)
                    continue;
                if (total + virtualSize > MaxImageScanBytes)
                    continue;

                total += virtualSize;
                info.WritableSections.Add(new Range
                {
                    Start = new IntPtr(baseAddress.ToInt64() + virtualAddress),
                    Size = virtualSize
                });
            }

            return info.WritableSections.Count > 0 && sizeOfImage > 0;
        }

        /// <summary>
        /// Committed, writable, private regions - i.e. the heap. Used only to decide whether a qword
        /// found in the image plausibly points at a heap object; we never scan these (4+ GB).
        /// </summary>
        private bool TryGetHeapRanges(out List<Range> ranges)
        {
            ranges = new List<Range>();

            var handle = EnsureQueryHandle();
            if (handle == IntPtr.Zero)
                return false;

            var mbiSize = (IntPtr)Marshal.SizeOf(typeof(NativeMethods.MEMORY_BASIC_INFORMATION));
            IntPtr address = IntPtr.Zero;
            int guard = 0;

            while (guard++ < 200000)
            {
                NativeMethods.MEMORY_BASIC_INFORMATION mbi;
                if (NativeMethods.VirtualQueryEx(handle, address, out mbi, mbiSize) == IntPtr.Zero)
                    break;

                long size = mbi.RegionSize.ToInt64();
                if (size <= 0)
                    break;

                if (mbi.State == NativeMethods.MEM_COMMIT &&
                    mbi.Type == NativeMethods.MEM_PRIVATE &&
                    NativeMethods.IsWritable(mbi.Protect))
                {
                    ranges.Add(new Range { Start = mbi.BaseAddress, Size = size });
                }

                long next = mbi.BaseAddress.ToInt64() + size;
                if (next <= address.ToInt64())
                    break;
                address = new IntPtr(next);
            }

            return ranges.Count > 0;
        }

        /// <summary>
        /// Fed from FFXIVRepository's ProcessChanged event (which also fires immediately with the
        /// current process), so we never have to poll for the game process ourselves.
        /// </summary>
        public void SetProcess(Process process)
        {
            int id = 0;
            try
            {
                id = process?.Id ?? 0;
            }
            catch (Exception)
            {
            }

            if (id != queryHandlePid)
                CloseQueryHandle();

            gameProcessId = id;
        }

        private IntPtr EnsureQueryHandle()
        {
            if (gameProcessId == 0)
                return IntPtr.Zero;

            if (queryHandle != IntPtr.Zero && queryHandlePid == gameProcessId)
                return queryHandle;

            CloseQueryHandle();

            // FFXIVMemory's own handle is opened read-only, which VirtualQueryEx can't use.
            queryHandle = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_INFORMATION | NativeMethods.PROCESS_VM_READ, false, gameProcessId);

            if (queryHandle == IntPtr.Zero)
            {
                logger?.Log(LogLevel.Debug, "PartyOverlay: OpenProcess failed: {0}", Marshal.GetLastWin32Error());
                return IntPtr.Zero;
            }

            queryHandlePid = gameProcessId;
            return queryHandle;
        }

        private void CloseQueryHandle()
        {
            if (queryHandle != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(queryHandle);
                queryHandle = IntPtr.Zero;
                queryHandlePid = 0;
            }
        }

        private static bool ContainsAddress(List<Range> sortedRanges, long value)
        {
            int low = 0, high = sortedRanges.Count - 1;
            while (low <= high)
            {
                int mid = (low + high) / 2;
                long start = sortedRanges[mid].Start.ToInt64();
                long end = start + sortedRanges[mid].Size;

                if (value < start) high = mid - 1;
                else if (value >= end) low = mid + 1;
                else return true;
            }

            return false;
        }

        private List<IntPtr> FindBytes(List<Range> ranges, byte[] needle)
        {
            var hits = new List<IntPtr>();
            if (needle == null || needle.Length == 0)
                return hits;

            foreach (var range in ranges)
            {
                long position = 0;

                while (position < range.Size)
                {
                    int length = (int)Math.Min(ScanChunkSize, range.Size - position);
                    if (length < needle.Length)
                        break;

                    var buffer = memory.Read8(new IntPtr(range.Start.ToInt64() + position), length);
                    if (buffer != null)
                    {
                        int limit = length - needle.Length;
                        for (int i = 0; i <= limit; i++)
                        {
                            if (buffer[i] != needle[0])
                                continue;

                            bool match = true;
                            for (int j = 1; j < needle.Length; j++)
                            {
                                if (buffer[i + j] != needle[j])
                                {
                                    match = false;
                                    break;
                                }
                            }

                            if (!match)
                                continue;

                            hits.Add(new IntPtr(range.Start.ToInt64() + position + i));
                            if (hits.Count >= MaxCandidateHits)
                                return hits;
                        }
                    }

                    // Overlap by needle-1 bytes so a match spanning two chunks is still found.
                    position += length - (needle.Length - 1);
                }
            }

            return hits;
        }

        private static string ReadString(byte[] buffer, int offset, int maxLength)
        {
            int length = 0;
            while (length < maxLength && offset + length < buffer.Length && buffer[offset + length] != 0)
                length++;

            return length == 0 ? string.Empty : Encoding.UTF8.GetString(buffer, offset, length);
        }

        private static class NativeMethods
        {
            public const uint PROCESS_QUERY_INFORMATION = 0x0400;
            public const uint PROCESS_VM_READ = 0x0010;
            public const uint MEM_COMMIT = 0x1000;
            public const uint MEM_PRIVATE = 0x20000;

            private const uint PAGE_READWRITE = 0x04;
            private const uint PAGE_WRITECOPY = 0x08;
            private const uint PAGE_EXECUTE_READWRITE = 0x40;
            private const uint PAGE_EXECUTE_WRITECOPY = 0x80;
            private const uint PAGE_GUARD = 0x100;
            private const uint PAGE_NOACCESS = 0x01;

            [StructLayout(LayoutKind.Sequential)]
            public struct MEMORY_BASIC_INFORMATION
            {
                public IntPtr BaseAddress;
                public IntPtr AllocationBase;
                public uint AllocationProtect;
                public uint Alignment1;
                public IntPtr RegionSize;
                public uint State;
                public uint Protect;
                public uint Type;
                public uint Alignment2;
            }

            public static bool IsWritable(uint protect)
            {
                if ((protect & PAGE_GUARD) != 0 || protect == PAGE_NOACCESS)
                    return false;

                return (protect & (PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)) != 0;
            }

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern IntPtr VirtualQueryEx(IntPtr process, IntPtr address,
                out MEMORY_BASIC_INFORMATION buffer, IntPtr length);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool CloseHandle(IntPtr handle);
        }

        #endregion
    }
}
