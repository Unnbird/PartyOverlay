param (
    # Configuration to package. Debug is only useful for local troubleshooting.
    [string]$Configuration = "Release",

    # Continuous integration mode: build Debug first so debug-only breakage gets caught too.
    [switch]$ci = $false,

    # Git ref of OverlayPlugin/OverlayPlugin to use when no source tree is present yet.
    [string]$OverlayPluginRef = "",

    # Assume OverlayPlugin's Thirdparty/ and the stripped FFXIVClientStructs are already in place.
    [switch]$SkipDeps = $false
)

$ErrorActionPreference = "Stop"

# Pinned so a fresh clone (and CI) builds against a known-good OverlayPlugin.
$DEFAULT_OVERLAYPLUGIN_REF = "v0.19.104"
$OVERLAYPLUGIN_URL = "https://github.com/OverlayPlugin/OverlayPlugin.git"

# PartyOverlayPlugin.csproj references ..\..\OverlayPlugin\* and writes to ..\..\out\, so this
# repository is expected to sit beside the OverlayPlugin checkout:
#   <workspace>/PartyOverlay                    <- this repository
#   <workspace>/PartyOverlay/PartyOverlayPlugin  <- plugin source (this csproj's folder)
#   <workspace>/PartyOverlay/ui                  <- overlay web assets
#   <workspace>/OverlayPlugin                    <- OverlayPlugin source
#   <workspace>/out                              <- build output
$repo = $PSScriptRoot
$workspace = Split-Path -Parent $repo
$opDir = Join-Path $workspace "OverlayPlugin"
$project = Join-Path $repo "PartyOverlayPlugin\PartyOverlayPlugin.csproj"

if (-not $OverlayPluginRef) {
    if ($env:OVERLAYPLUGIN_REF) {
        $OverlayPluginRef = $env:OVERLAYPLUGIN_REF
    } else {
        $OverlayPluginRef = $DEFAULT_OVERLAYPLUGIN_REF
    }
}

function Get-AssemblyVersion($propsPath) {
    [xml]$props = Get-Content -Path $propsPath
    $version = ($props.Project.PropertyGroup.AssemblyVersion | Out-String).Trim()
    if (-not $version) { throw "No AssemblyVersion found in $propsPath" }
    return $version
}

Push-Location $workspace
try {
    # An existing checkout is left alone - it may hold local work.
    if (-not (Test-Path (Join-Path $opDir "OverlayPlugin.sln"))) {
        echo "==> Cloning OverlayPlugin $OverlayPluginRef..."
        git clone --depth 1 --branch $OverlayPluginRef $OVERLAYPLUGIN_URL $opDir
        if ($LASTEXITCODE -ne 0) { throw "Failed to clone OverlayPlugin" }
    } else {
        echo "==> Using existing OverlayPlugin checkout"
    }

    if (-not $SkipDeps) {
        Push-Location $opDir
        try {
            # Downloads the ACT / FFXIV_ACT_Plugin SDK / FFXIVClientStructs archives our
            # HintPaths point at. No-ops while DEPS.cache still matches DEPS.json.
            echo "==> Fetching OverlayPlugin dependencies..."
            & .\tools\fetch_deps.ps1

            # OverlayPlugin.Core compiles the *stripped* copies of FFXIVClientStructs;
            # without them Core doesn't build, and Core is our ProjectReference.
            $structsBase = Get-Item "OverlayPlugin.Core\Thirdparty\FFXIVClientStructs\Base" -ErrorAction SilentlyContinue
            $structsOut = Get-Item "OverlayPlugin.Core\Thirdparty\FFXIVClientStructs\Transformed" -ErrorAction SilentlyContinue
            if ($structsBase -and (-not $structsOut -or $structsOut.LastWriteTime -lt $structsBase.LastWriteTime)) {
                echo "==> Stripping FFXIVClientStructs..."
                & .\tools\strip-clientstructs.ps1
            }
        } finally {
            Pop-Location
        }
    }

    # FetchDeps/StripClientStructs are MSBuild targets of OverlayPlugin's VSBuildDeps
    # project. They rely on $(SolutionDir), which is undefined when building a bare csproj
    # like ours, so they run above instead and stay out of the build itself.
    $buildArgs = @("-p:FetchDeps=false", "-p:StripClientStructs=false")

    if ($ci) {
        echo "==> Continuous integration flag set. Building Debug..."
        dotnet publish $project -c Debug @buildArgs
        if ($LASTEXITCODE -ne 0) { throw "Debug build failed" }
    }

    echo "==> Building $Configuration..."
    dotnet publish $project -c $Configuration @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "$Configuration build failed" }

    echo "==> Building archive..."

    $version = Get-AssemblyVersion (Join-Path $repo "Directory.Build.props")
    $outDir = Join-Path $workspace "out\$Configuration\addons\net48"
    $stage = Join-Path $workspace "out\$Configuration\package"
    $pkg = Join-Path $stage "PartyOverlay"

    $dll = Join-Path $outDir "PartyOverlayPlugin.dll"
    if (-not (Test-Path $dll)) { throw "Build output not found: $dll" }

    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    New-Item -ItemType Directory -Path $pkg | Out-Null

    # An OverlayPlugin addon ships only its own assembly plus its web assets; every
    # third-party dependency is already loaded by OverlayPlugin itself.
    Copy-Item $dll $pkg
    if ($Configuration -eq "Debug") {
        $pdb = Join-Path $outDir "PartyOverlayPlugin.pdb"
        if (Test-Path $pdb) { Copy-Item $pdb $pkg }
    }

    $ui = Join-Path $repo "ui"
    if (-not (Test-Path $ui)) { throw "ui/ directory not found: $ui" }
    Copy-Item -Recurse $ui (Join-Path $pkg "ui")

    $suffix = if ($Configuration -eq "Release") { "" } else { "-$Configuration" }
    $archive = Join-Path $workspace "out\PartyOverlay-$version$suffix.zip"
    if (Test-Path $archive) { Remove-Item $archive }
    Compress-Archive -Path $pkg -DestinationPath $archive

    echo "==> Done: $archive"
} finally {
    Pop-Location
}
