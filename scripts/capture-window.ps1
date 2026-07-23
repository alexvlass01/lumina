[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [string]$WindowTitle = 'Lumina',

    [int]$ProcessId = 0,

    # Capture this exact top-level window handle, bypassing title/process search.
    [long]$WindowHandle = 0,

    # Restore/reveal the target window before capture (handles a window hidden in
    # the tray or minimized) without stealing keyboard focus.
    [switch]$Show,

    [switch]$AllowScreenFallback
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

if (-not ('HermesQa.WindowCaptureNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace HermesQa {
    public struct WindowInfo {
        public IntPtr Handle;
        public int ProcessId;
        public string Title;
        public bool Visible;
        public bool Minimized;
        public int Width;
        public int Height;
    }

    public static class WindowCaptureNative {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hwnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsIconic(IntPtr hwnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hwnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindow(IntPtr hwnd, int cmd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(
            IntPtr hwnd,
            int attribute,
            out RECT value,
            int valueSize
        );

        // Enumerate every top-level window (not just each process's MainWindowHandle),
        // so a process that owns several windows can be targeted precisely by title.
        public static List<WindowInfo> ListTopLevelWindows() {
            var results = new List<WindowInfo>();
            EnumWindows(
                (hwnd, lParam) => {
                    uint pid;
                    GetWindowThreadProcessId(hwnd, out pid);
                    int len = GetWindowTextLength(hwnd);
                    var sb = new StringBuilder(len + 1);
                    GetWindowText(hwnd, sb, sb.Capacity);
                    RECT r;
                    GetWindowRect(hwnd, out r);
                    results.Add(new WindowInfo {
                        Handle = hwnd,
                        ProcessId = (int)pid,
                        Title = sb.ToString(),
                        Visible = IsWindowVisible(hwnd),
                        Minimized = IsIconic(hwnd),
                        Width = r.Right - r.Left,
                        Height = r.Bottom - r.Top
                    });
                    return true;
                },
                IntPtr.Zero
            );
            return results;
        }
    }
}
'@
}

# ShowWindow command codes.
$SW_RESTORE = 9   # un-minimize and activate
$SW_SHOWNA  = 8   # show in current state without activating (no focus theft)

function Resolve-TargetWindow {
    # An explicit handle wins over any search.
    if ($WindowHandle -ne 0) {
        $handle = [IntPtr]$WindowHandle
        if (-not [HermesQa.WindowCaptureNative]::IsWindow($handle)) {
            throw "WindowHandle $WindowHandle is not a live window."
        }
        $known = [HermesQa.WindowCaptureNative]::ListTopLevelWindows() |
            Where-Object { $_.Handle -eq $handle } |
            Select-Object -First 1
        if ($known) { return $known }
        $info = New-Object HermesQa.WindowInfo
        $info.Handle = $handle
        return $info
    }

    $targetLower = $WindowTitle.ToLowerInvariant()
    $candidates = @(
        [HermesQa.WindowCaptureNative]::ListTopLevelWindows() | Where-Object {
            $_.Title -and
            $_.Title.ToLowerInvariant().Contains($targetLower) -and
            ($ProcessId -le 0 -or $_.ProcessId -eq $ProcessId) -and
            ($Show -or $_.Visible)
        }
    )

    if ($candidates.Count -eq 0) {
        $scope = if ($ProcessId -gt 0) { " for process $ProcessId" } else { '' }
        throw "No window with a title containing '$WindowTitle' was found$scope. Pass -Show to include a window hidden in the tray, or -WindowHandle to target an exact window."
    }

    # Rank: exact title match first, then visible, then largest area (this prefers
    # the real app window over a small companion panel such as 'Lumina Diagnostics').
    return $candidates |
        Sort-Object `
            @{ Expression = { if ($_.Title.ToLowerInvariant() -eq $targetLower) { 1 } else { 0 } }; Descending = $true }, `
            @{ Expression = { if ($_.Visible) { 1 } else { 0 } }; Descending = $true }, `
            @{ Expression = { [long]$_.Width * [long]$_.Height }; Descending = $true } |
        Select-Object -First 1
}

function Get-WindowBounds([IntPtr]$Handle) {
    $rect = New-Object HermesQa.WindowCaptureNative+RECT
    $size = [Runtime.InteropServices.Marshal]::SizeOf($rect)

    # DWMWA_EXTENDED_FRAME_BOUNDS = 9. This excludes invisible resize shadows.
    $hr = [HermesQa.WindowCaptureNative]::DwmGetWindowAttribute(
        $Handle,
        9,
        [ref]$rect,
        $size
    )

    if ($hr -ne 0 -or $rect.Right -le $rect.Left -or $rect.Bottom -le $rect.Top) {
        if (-not [HermesQa.WindowCaptureNative]::GetWindowRect($Handle, [ref]$rect)) {
            throw 'Unable to read target window bounds.'
        }
    }

    return $rect
}

function Test-BitmapHasContent([System.Drawing.Bitmap]$Bitmap) {
    $colors = New-Object 'System.Collections.Generic.HashSet[int]'
    $xStep = [Math]::Max(1, [int]($Bitmap.Width / 12))
    $yStep = [Math]::Max(1, [int]($Bitmap.Height / 8))

    for ($y = 0; $y -lt $Bitmap.Height; $y += $yStep) {
        for ($x = 0; $x -lt $Bitmap.Width; $x += $xStep) {
            [void]$colors.Add($Bitmap.GetPixel($x, $y).ToArgb())
            if ($colors.Count -ge 3) {
                return $true
            }
        }
    }

    return $false
}

$target = Resolve-TargetWindow
$handle = [IntPtr]$target.Handle
$targetTitle = if ($target.Title) { $target.Title } else { '(untitled)' }

if ($Show) {
    if ([HermesQa.WindowCaptureNative]::IsIconic($handle)) {
        [void][HermesQa.WindowCaptureNative]::ShowWindow($handle, $SW_RESTORE)
    }
    else {
        [void][HermesQa.WindowCaptureNative]::ShowWindow($handle, $SW_SHOWNA)
    }
    Start-Sleep -Milliseconds 400
}
elseif ([HermesQa.WindowCaptureNative]::IsIconic($handle)) {
    throw "Window '$targetTitle' is minimized. Restore it before taking QA evidence, or re-run with -Show."
}

$rect = Get-WindowBounds $handle
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -lt 1 -or $height -lt 1) {
    throw "Invalid target window size: $($width)x$($height) (window '$targetTitle' may be hidden; try -Show)."
}

$bitmap = New-Object System.Drawing.Bitmap(
    $width,
    $height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$method = 'PrintWindow'

try {
    $hdc = $graphics.GetHdc()
    try {
        # PW_RENDERFULLCONTENT = 2. Works for Chromium/Electron windows on modern Windows.
        $printed = [HermesQa.WindowCaptureNative]::PrintWindow($handle, $hdc, 2)
    }
    finally {
        $graphics.ReleaseHdc($hdc)
    }

    if (-not $printed -or -not (Test-BitmapHasContent $bitmap)) {
        if (-not $AllowScreenFallback) {
            throw 'PrintWindow returned an empty image. Keep Lumina visible (or pass -Show) and retry with -AllowScreenFallback only if a cropped screen capture is acceptable.'
        }

        $graphics.Clear([System.Drawing.Color]::Black)
        $graphics.CopyFromScreen(
            $rect.Left,
            $rect.Top,
            0,
            0,
            (New-Object System.Drawing.Size($width, $height)),
            [System.Drawing.CopyPixelOperation]::SourceCopy
        )
        $method = 'CopyFromScreen-cropped'

        if (-not (Test-BitmapHasContent $bitmap)) {
            throw 'Screen fallback also returned an empty image.'
        }
    }

    $fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    $parent = [System.IO.Path]::GetDirectoryName($fullOutputPath)
    if ($parent) {
        [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    }

    $bitmap.Save($fullOutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    [ordered]@{
        path = $fullOutputPath
        process_id = $target.ProcessId
        window_handle = $handle.ToInt64()
        window_title = $target.Title
        shown = [bool]$Show
        width = $width
        height = $height
        method = $method
    } | ConvertTo-Json -Compress
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
