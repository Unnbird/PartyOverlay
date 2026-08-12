using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using Advanced_Combat_Tracker;
using RainbowMage.OverlayPlugin;
using RainbowMage.OverlayPlugin.MemoryProcessors.Party;

namespace PartyOverlayPlugin
{
    public class PartyOverlayPreset : IOverlayPreset
    {
        public string Name { get; set; }
        public string Type { get; set; } = "MiniParse";
        public string Url { get; set; }
        public int[] Size { get; set; } = new int[] { 600, 400 };
        public bool Locked { get; set; } = false;
        public List<string> Supports { get; set; } = new List<string> { "modern" };
    }

    public class PartyOverlayAddon : IActPluginV1, IOverlayAddonV2
    {
        public static string PluginPath { get; private set; } = string.Empty;
        private bool isInitialized = false;

        public void InitPlugin(TabPage pluginScreenSpace, Label pluginStatusText)
        {
            pluginStatusText.Text = "PartyOverlay Plugin Ready.";

            if (pluginScreenSpace?.Parent is TabControl parentTab)
            {
                parentTab.TabPages.Remove(pluginScreenSpace);
            }

            foreach (var plugin in ActGlobals.oFormActMain.ActPlugins)
            {
                if (plugin.pluginObj == this)
                {
                    PluginPath = plugin.pluginFile.FullName;
                    break;
                }
            }

            // During ACT startup we must NOT call Init() here: OverlayPlugin only registers
            // FFXIVRepository / FFXIVMemory / IPartyMemory in its second init phase, which runs
            // after ACT has loaded every plugin. Starting the event source now would resolve those
            // services too early, which either throws or (worse) makes TinyIoC construct throwaway
            // duplicates that never receive the FFXIV process - leaving the overlay permanently
            // without data. OverlayPlugin calls IOverlayAddonV2.Init() at the right time instead.
            //
            // If OverlayPlugin is already fully initialized we are being enabled by hand later on,
            // and LoadAddons() won't run again, so we do have to start ourselves.
            if (IsOverlayPluginReady())
            {
                Init();
            }
        }

        private static bool IsOverlayPluginReady()
        {
            try
            {
                var container = Registry.GetContainer();
                return container != null && container.CanResolve<IPartyMemory>();
            }
            catch (Exception)
            {
                return false;
            }
        }

        public void DeInitPlugin()
        {
        }

        public void Init()
        {
            if (isInitialized) return;

            try
            {
                var container = Registry.GetContainer();
                if (container == null) return;

                var registry = container.Resolve<Registry>();
                if (registry == null) return;

                registry.StartEventSource(new PartyOverlayEventSource(container));
                RegisterPresets(registry);
                CheckForUpdates(container);
                isInitialized = true;
            }
            catch (Exception ex)
            {
                ActGlobals.oFormActMain?.WriteExceptionLog(ex, "PartyOverlayInitError");
            }
        }

        private async void CheckForUpdates(RainbowMage.OverlayPlugin.TinyIoCContainer container)
        {
            try
            {
                string pluginDir = !string.IsNullOrEmpty(PluginPath) 
                    ? Path.GetDirectoryName(PluginPath) 
                    : Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);

                if (string.IsNullOrEmpty(pluginDir)) return;

                var currentVer = Assembly.GetExecutingAssembly().GetName().Version;

                // Diagnostic logging
                ActGlobals.oFormActMain?.WriteInfoLog(
                    $"[PartyOverlay] Update check: pluginDir={pluginDir}, " +
                    $"PluginPath={PluginPath}, " +
                    $"currentVersion={currentVer}, " +
                    $"AssemblyLocation={Assembly.GetExecutingAssembly().Location}");

                var options = new RainbowMage.OverlayPlugin.Updater.UpdaterOptions
                {
                    project = "PartyOverlay",
                    pluginDirectory = pluginDir,
                    lastCheck = DateTime.MinValue,
                    currentVersion = currentVer,
                    checkInterval = TimeSpan.FromHours(1),
                    repo = "Unnbird/PartyOverlay",
                    downloadUrl = "https://github.com/{REPO}/releases/download/v{VERSION}/PartyOverlay-{VERSION}.zip",
                    strippedDirs = 1,
                };

                await System.Threading.Tasks.Task.Run(() => RainbowMage.OverlayPlugin.Updater.Updater.RunAutoUpdater(options, false));
            }
            catch (Exception ex)
            {
                ActGlobals.oFormActMain?.WriteExceptionLog(ex, "PartyOverlayCheckUpdateError");
            }
        }

        private void RegisterPresets(Registry registry)
        {
            try
            {
                string pluginDir = !string.IsNullOrEmpty(PluginPath) 
                    ? Path.GetDirectoryName(PluginPath) 
                    : Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);

                if (string.IsNullOrEmpty(pluginDir)) return;

                string uiDir = FindUiDirectory(pluginDir);
                if (string.IsNullOrEmpty(uiDir)) return;

                RegisterPreset(registry, "PartyOverlay", Path.Combine(uiDir, "index.html"), new int[] { 900, 600 });
            }
            catch (Exception ex)
            {
                ActGlobals.oFormActMain?.WriteExceptionLog(ex, "PartyOverlayRegisterPresetsError");
            }
        }

        private static string FindUiDirectory(string baseDir)
        {
            string candidate = Path.Combine(baseDir, "ui");
            if (Directory.Exists(candidate)) return candidate;

            candidate = Path.GetFullPath(Path.Combine(baseDir, "..", "ui"));
            if (Directory.Exists(candidate)) return candidate;

            candidate = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "ui"));
            if (Directory.Exists(candidate)) return candidate;

            return null;
        }

        private static void RegisterPreset(Registry registry, string presetName, string filePath, int[] defaultSize)
        {
            if (!File.Exists(filePath)) return;

            string fileUrl = new Uri(filePath).AbsoluteUri;

            if (!registry.OverlayPresets.Any(p => p.Name == presetName))
            {
                registry.RegisterOverlayPreset2(new PartyOverlayPreset
                {
                    Name = presetName,
                    Type = "MiniParse",
                    Url = fileUrl,
                    Size = defaultSize,
                    Locked = false,
                    Supports = new List<string> { "modern" }
                });
            }
        }
    }
}
