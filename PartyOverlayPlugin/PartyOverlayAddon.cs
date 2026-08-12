using System;
using System.Windows.Forms;
using Advanced_Combat_Tracker;
using RainbowMage.OverlayPlugin;
using RainbowMage.OverlayPlugin.MemoryProcessors.Party;

namespace PartyOverlayPlugin
{
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
                isInitialized = true;
            }
            catch (Exception ex)
            {
                ActGlobals.oFormActMain?.WriteExceptionLog(ex, "PartyOverlayInitError");
            }
        }
    }
}
