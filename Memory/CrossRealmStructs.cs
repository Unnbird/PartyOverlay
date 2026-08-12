namespace PartyOverlayPlugin.Memory
{
    /// <summary>
    /// Field layout of <c>Client::UI::Info::InfoProxyCrossRealm</c> / <c>CrossRealmGroup</c> /
    /// <c>CrossRealmMember</c>, transcribed from upstream FFXIVClientStructs.
    ///
    /// These are kept here rather than using the FFXIVClientStructs copy vendored in
    /// OverlayPlugin.Core, because that copy is pinned to commit 39b39c12 (ida/data.yml says game
    /// version 2023.06.14, i.e. patch 6.4) and the cross-realm structs were re-laid-out in 7.0.
    /// Using it against a Dawntrail client - including the TC client, whose content matches global
    /// 7.3x - reads pure garbage. OverlayPlugin has the same problem and solves it the same way:
    /// see the per-version <c>#region FFXIVClientStructs structs</c> blocks in PartyMemory70/72 and
    /// CombatantMemory70..75.
    ///
    /// Verified against upstream at these revisions (aers/FFXIVClientStructs,
    /// FFXIVClientStructs/FFXIV/Client/UI/Info/InfoProxyCrossRealm.cs):
    ///
    ///   patch          member  group   groups@  contentId  name      memberIdx
    ///   6.4  (39b39c12) 0x58    0x2C8   0x3A0    0x08       0x2B/30   0x50
    ///   7.0  (f0966150) 0x68    0x348   0x480    0x10       0x33/32   0x60
    ///   7.31 (145d1af4) 0x68    0x348   0x480    0x10       0x33/32   0x60
    ///   7.35 (506c1a81) 0x68    0x348   0x480    0x10       0x33/32   0x60
    ///   7.40 (e1a5f332) 0x68    0x348   0x480    0x10       0x33/32   0x60
    ///   7.50 (25b0d4b2) 0x68    0x348   0x480    0x10       0x33/32   0x60
    ///   7.51 (2c914a52) 0x68    0x348   0x498    0x10       0x33/32   0x60
    ///   7.55 (b68d0793) 0x68    0x348   0x498    0x10       0x33/32   0x60
    ///
    /// Note what does and does not move: the member/group layout has been stable across all of
    /// Dawntrail, while the *position of the group array inside the proxy* shifted in 7.51. We
    /// therefore anchor on the group array itself instead of the proxy base, which makes that shift
    /// irrelevant - and the small header in front of the group array has sat at a constant negative
    /// delta from it in every revision above, so it comes along for free.
    /// </summary>
    public sealed class CrossRealmLayout
    {
        /// <summary>Bytes in front of the group array that hold the proxy's party header.</summary>
        public const int HeaderPrefix = 0x13;

        // Header positions, relative to the start of the header prefix
        // (i.e. groupArray - HeaderPrefix). Constant for every known revision.
        public const int LocalPlayerGroupIndexOffset = 0x00; // proxy+0x38D (6.4) / +0x46D (7.3) / +0x485 (7.51)
        public const int GroupCountOffset = 0x01;
        public const int IsCrossRealmOffset = 0x03;
        public const int IsInAllianceRaidOffset = 0x04;
        public const int IsPartyLeaderOffset = 0x05;
        public const int IsInCrossRealmPartyOffset = 0x06;

        public string Name { get; private set; }

        /// <summary>
        /// Candidate offsets of the group array inside the proxy object. Needed because on 7.x the
        /// proxy is heap allocated and we find it through the pointer slot in .data, i.e. we start at
        /// the object base rather than at the group array. Validation picks the right one.
        /// 7.0-7.50 use 0x480, 7.51+ use 0x498.
        /// </summary>
        public int[] GroupsOffsets { get; private set; }

        /// <summary>
        /// True when the singleton object itself lives in the image's writable sections (6.x), false
        /// when .data only holds a pointer to a heap allocation (7.x).
        /// FFXIVClientStructs ida/data.yml records this as the `pointer:` flag on the class instance:
        ///   6.4  -> ea: 0x142118BB8                 (object embedded in .data)
        ///   7.35 -> ea: 0x1429348B8, pointer: true  (heap allocated)
        /// </summary>
        public bool InstanceEmbeddedInImage { get; private set; }

        public int MaxGroups { get; private set; }
        public int GroupSize { get; private set; }
        public int GroupMemberCountOffset { get; private set; }
        public int GroupMembersOffset { get; private set; }

        public int MaxGroupMembers { get; private set; }
        public int MemberSize { get; private set; }
        public int ContentIdOffset { get; private set; }
        public int EntityIdOffset { get; private set; }
        public int LevelOffset { get; private set; }
        public int HomeWorldOffset { get; private set; }
        public int CurrentWorldOffset { get; private set; }
        public int ClassJobOffset { get; private set; }
        public int NameOffset { get; private set; }
        public int NameLength { get; private set; }
        public int MemberIndexOffset { get; private set; }
        public int GroupIndexOffset { get; private set; }
        public int IsPartyLeaderMemberOffset { get; private set; }

        /// <summary>Bytes to read: the header prefix plus the whole group array.</summary>
        public int ReadSize => HeaderPrefix + (MaxGroups * GroupSize);

        /// <summary>
        /// Dawntrail (7.0 - 7.55). This is the layout the TC client uses - its content matches
        /// global 7.3x, and the cross-realm structs are identical across all of 7.x.
        /// </summary>
        public static readonly CrossRealmLayout Dawntrail = new CrossRealmLayout
        {
            Name = "7.x (Dawntrail / TC)",
            GroupsOffsets = new[] { 0x480, 0x498 },
            InstanceEmbeddedInImage = false,
            MaxGroups = 6,
            GroupSize = 0x348,
            GroupMemberCountOffset = 0x00,
            GroupMembersOffset = 0x08,
            MaxGroupMembers = 8,
            MemberSize = 0x68,
            ContentIdOffset = 0x10,
            EntityIdOffset = 0x20,
            LevelOffset = 0x28,
            HomeWorldOffset = 0x2A,
            CurrentWorldOffset = 0x2C,
            ClassJobOffset = 0x2E,
            NameOffset = 0x33,
            NameLength = 32,
            MemberIndexOffset = 0x60,
            GroupIndexOffset = 0x61,
            IsPartyLeaderMemberOffset = 0x63
        };

        /// <summary>
        /// Endwalker and older (up to 6.5). Kept as a fallback so the same build still works on a
        /// regional client that hasn't reached Dawntrail yet; the layout is picked by validation, so
        /// having it listed costs nothing but one extra scan pass.
        /// </summary>
        public static readonly CrossRealmLayout Endwalker = new CrossRealmLayout
        {
            Name = "6.x (Endwalker)",
            GroupsOffsets = new[] { 0x3A0 },
            InstanceEmbeddedInImage = true,
            MaxGroups = 6,
            GroupSize = 0x2C8,
            GroupMemberCountOffset = 0x00,
            GroupMembersOffset = 0x08,
            MaxGroupMembers = 8,
            MemberSize = 0x58,
            ContentIdOffset = 0x08,
            EntityIdOffset = 0x18,
            LevelOffset = 0x20,
            HomeWorldOffset = 0x22,
            CurrentWorldOffset = 0x24,
            ClassJobOffset = 0x26,
            NameOffset = 0x2B,
            NameLength = 30,
            MemberIndexOffset = 0x50,
            GroupIndexOffset = 0x51,
            IsPartyLeaderMemberOffset = 0x53
        };

        /// <summary>Tried in order; the first one that validates structurally wins.</summary>
        public static readonly CrossRealmLayout[] Candidates = { Dawntrail, Endwalker };

        private CrossRealmLayout()
        {
        }
    }
}
