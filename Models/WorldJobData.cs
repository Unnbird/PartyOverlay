using System.Collections.Generic;

namespace PartyOverlayPlugin.Models
{
    public static class WorldJobData
    {
        // ClassJob ids as of 7.x. These must stay aligned with the game's ClassJob sheet:
        // an off-by-one here silently mislabels almost every job and role.
        private static readonly Dictionary<byte, (string Name, string Role, string LocalizedName)> JobMap = new Dictionary<byte, (string, string, string)>
        {
            { 0, ("ADV", "Unknown", "冒險者") },
            { 1, ("GLA", "Tank", "劍術師") },
            { 2, ("PGL", "DPS", "格鬥家") },
            { 3, ("MRD", "Tank", "斧術師") },
            { 4, ("LNC", "DPS", "槍術師") },
            { 5, ("ARC", "DPS", "弓箭手") },
            { 6, ("CNJ", "Healer", "幻術師") },
            { 7, ("THM", "DPS", "咒術師") },
            { 8, ("CRP", "Crafter", "刻木匠") },
            { 9, ("BSM", "Crafter", "鍛鐵匠") },
            { 10, ("ARM", "Crafter", "鎧甲匠") },
            { 11, ("GSM", "Crafter", "雕金匠") },
            { 12, ("LTW", "Crafter", "製革匠") },
            { 13, ("WVR", "Crafter", "裁縫匠") },
            { 14, ("ALC", "Crafter", "鍊金術士") },
            { 15, ("CUL", "Crafter", "烹調師") },
            { 16, ("MIN", "Gatherer", "採礦工") },
            { 17, ("BTN", "Gatherer", "園藝工") },
            { 18, ("FSH", "Gatherer", "捕魚人") },
            { 19, ("PLD", "Tank", "騎士") },
            { 20, ("MNK", "DPS", "武僧") },
            { 21, ("WAR", "Tank", "戰士") },
            { 22, ("DRG", "DPS", "龍騎士") },
            { 23, ("BRD", "DPS", "吟遊詩人") },
            { 24, ("WHM", "Healer", "白魔法師") },
            { 25, ("BLM", "DPS", "黑魔法師") },
            { 26, ("ACN", "DPS", "秘術師") },
            { 27, ("SMN", "DPS", "召喚師") },
            { 28, ("SCH", "Healer", "學者") },
            { 29, ("ROG", "DPS", "雙劍師") },
            { 30, ("NIN", "DPS", "忍者") },
            { 31, ("MCH", "DPS", "機工士") },
            { 32, ("DRK", "Tank", "暗黑騎士") },
            { 33, ("AST", "Healer", "占星術士") },
            { 34, ("SAM", "DPS", "武士") },
            { 35, ("RDM", "DPS", "赤魔法師") },
            { 36, ("BLU", "DPS", "青魔法師") },
            { 37, ("GNB", "Tank", "絕槍戰士") },
            { 38, ("DNC", "DPS", "舞者") },
            { 39, ("RPR", "DPS", "釤鐮客") },
            { 40, ("SGE", "Healer", "賢者") },
            { 41, ("VPR", "DPS", "蝰蛇劍士") },
            { 42, ("PCT", "DPS", "繪靈法師") }
        };

        // World id -> name, filled in at runtime from FFXIV_ACT_Plugin's WorldList resource
        // (see CrossRealmPartyMemory.EnsureWorldNames). Hardcoding ids is not viable in general:
        // they differ per region and new worlds are added every patch.
        private static IDictionary<uint, string> worldNames;
        private static IDictionary<ushort, string> worldNameOverrides;
        private static readonly object worldNamesLock = new object();

        // FFXIV_ACT_Plugin's WorldList_EN resource covers 1-999 (global), 1xxx (CN), 2xxx (KR),
        // 10xxx and 65xxx - it has no 4xxx entries at all, so TC worlds would otherwise render as
        // "World-4030". These names are as the client itself reports them in ACT's network log
        // (line 03 carries worldId plus the resolved world name).
        // 4034 is intentionally absent: no member from it has been observed, and guessing a name is
        // worse than falling back to "World-4034". Add it via the override file when it shows up.
        private static readonly Dictionary<ushort, string> TcWorldNames = new Dictionary<ushort, string>
        {
            { 4028, "伊弗利特" },
            { 4029, "迦樓羅" },
            { 4030, "利維坦" },
            { 4031, "鳳凰" },
            { 4032, "奧汀" },
            { 4033, "巴哈姆特" },
            { 4035, "泰坦" }
        };

        public static void SetWorldNames(IDictionary<uint, string> names)
        {
            lock (worldNamesLock)
            {
                worldNames = names;
            }
        }

        /// <summary>
        /// User supplied id -> name pairs, which win over everything else. Lets a world that neither
        /// FFXIV_ACT_Plugin nor <see cref="TcWorldNames"/> knows be named without a rebuild.
        /// </summary>
        public static void SetWorldNameOverrides(IDictionary<ushort, string> overrides)
        {
            lock (worldNamesLock)
            {
                worldNameOverrides = overrides;
            }
        }

        public static bool HasWorldNames
        {
            get
            {
                lock (worldNamesLock)
                {
                    return worldNames != null && worldNames.Count > 0;
                }
            }
        }

        public static (string Name, string Role) GetJobInfo(byte jobId)
        {
            if (JobMap.TryGetValue(jobId, out var info))
                return (info.Name, info.Role);
            return ($"Job-{jobId}", "Unknown");
        }

        public static (string Name, string Role, string LocalizedName) GetFullJobInfo(byte jobId)
        {
            if (JobMap.TryGetValue(jobId, out var info))
                return info;
            return ($"Job-{jobId}", "Unknown", $"未知職業({jobId})");
        }

        public static string GetWorldName(ushort worldId)
        {
            if (worldId == 0) return string.Empty;

            lock (worldNamesLock)
            {
                if (worldNameOverrides != null &&
                    worldNameOverrides.TryGetValue(worldId, out var custom) && !string.IsNullOrEmpty(custom))
                    return custom;

                if (worldNames != null && worldNames.TryGetValue(worldId, out var name) && !string.IsNullOrEmpty(name))
                    return name;
            }

            if (TcWorldNames.TryGetValue(worldId, out var tcName))
                return tcName;

            return $"World-{worldId}";
        }
    }
}
