using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace PartyOverlayPlugin.Models
{
    public enum PartyType
    {
        None = 0,
        Solo = 1,
        StandardParty = 2,
        CrossRealmParty = 3,
        Alliance = 4
    }

    public class PartyMemberData
    {
        [JsonProperty("name")]
        public string Name { get; set; } = string.Empty;

        [JsonProperty("homeWorldId")]
        public ushort HomeWorldId { get; set; }

        [JsonProperty("homeWorldName")]
        public string HomeWorldName { get; set; } = string.Empty;

        [JsonProperty("currentWorldId")]
        public ushort CurrentWorldId { get; set; }

        [JsonProperty("currentWorldName")]
        public string CurrentWorldName { get; set; } = string.Empty;

        [JsonProperty("jobId")]
        public byte JobId { get; set; }

        [JsonProperty("jobName")]
        public string JobName { get; set; } = string.Empty;

        [JsonProperty("jobRole")]
        public string JobRole { get; set; } = string.Empty;

        [JsonProperty("level")]
        public byte Level { get; set; }

        [JsonProperty("contentId")]
        public string ContentId { get; set; } = "0";

        [JsonProperty("objectId")]
        public uint ObjectId { get; set; }

        [JsonProperty("isLeader")]
        public bool IsLeader { get; set; }

        [JsonProperty("isCrossRealm")]
        public bool IsCrossRealm { get; set; }

        [JsonProperty("inCurrentZone")]
        public bool InCurrentZone { get; set; }

        [JsonProperty("currentHP")]
        public uint CurrentHP { get; set; }

        [JsonProperty("maxHP")]
        public uint MaxHP { get; set; }

        [JsonProperty("currentMP")]
        public ushort CurrentMP { get; set; }

        [JsonProperty("maxMP")]
        public ushort MaxMP { get; set; }

        [JsonProperty("memberIndex")]
        public int MemberIndex { get; set; }

        /// <summary>0 = own party, 1-5 = alliance group B-F.</summary>
        [JsonProperty("groupIndex")]
        public int GroupIndex { get; set; }

        [JsonProperty("territoryType")]
        public ushort TerritoryType { get; set; }
    }

    public class PartyStateData
    {
        [JsonProperty("partyType")]
        public string PartyType { get; set; } = Models.PartyType.None.ToString();

        [JsonProperty("partyId")]
        public string PartyId { get; set; } = "0";

        [JsonProperty("leaderIndex")]
        public int LeaderIndex { get; set; }

        [JsonProperty("memberCount")]
        public int MemberCount { get; set; }

        [JsonProperty("isCrossRealm")]
        public bool IsCrossRealm { get; set; }

        [JsonProperty("members")]
        public List<PartyMemberData> Members { get; set; } = new List<PartyMemberData>();

        [JsonProperty("timestamp")]
        public string Timestamp { get; set; } = DateTimeOffset.UtcNow.ToString("o");

        /// <summary>Human readable status of the memory reader, shown in the overlay when empty.</summary>
        [JsonProperty("diagnostic")]
        public string Diagnostic { get; set; } = string.Empty;

        /// <summary>Where the data came from: InfoProxyCrossRealm / GroupManager / SelfCombatant.</summary>
        [JsonProperty("source")]
        public string Source { get; set; } = string.Empty;
    }
}
