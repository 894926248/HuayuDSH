[CmdletBinding()]
param(
  [string]$RepositoryRoot = '',
  [string[]]$ShortcutPath = @((Join-Path $env:USERPROFILE 'Desktop\DeepSeek Harness.lnk')),
  [string]$TargetPath = '',
  [string]$IconPath = '',
  [string]$AppUserModelId = 'ai.deepseek.harness'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$env:LIB = ''

$scriptRoot = Split-Path -Parent $PSCommandPath
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
  $RepositoryRoot = (Resolve-Path (Join-Path $scriptRoot '..\..\..')).Path
}
if ([string]::IsNullOrWhiteSpace($TargetPath)) {
  $TargetPath = Join-Path $RepositoryRoot 'product\artifacts\active\DeepSeek Harness.exe'
}
if ([string]::IsNullOrWhiteSpace($IconPath)) {
  $IconPath = Join-Path $RepositoryRoot 'apps\desktop\build\icon.ico'
}

$target = (Resolve-Path -LiteralPath $TargetPath).Path
$icon = (Resolve-Path -LiteralPath $IconPath).Path

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct DshPropertyKey
{
    public Guid FormatId;
    public uint PropertyId;

    public DshPropertyKey(Guid formatId, uint propertyId)
    {
        FormatId = formatId;
        PropertyId = propertyId;
    }
}

[StructLayout(LayoutKind.Explicit, Size = 16)]
public struct DshPropVariant
{
    [FieldOffset(0)] public ushort VariantType;
    [FieldOffset(8)] public IntPtr StringValue;

    public static DshPropVariant FromString(string value)
    {
        return new DshPropVariant
        {
            VariantType = 31,
            StringValue = Marshal.StringToCoTaskMemUni(value),
        };
    }

    public void Free()
    {
        if (StringValue == IntPtr.Zero) return;
        Marshal.FreeCoTaskMem(StringValue);
        StringValue = IntPtr.Zero;
    }
}

[ComImport]
[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface DshPropertyStore
{
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out DshPropertyKey key);
    [PreserveSig] int GetValue(ref DshPropertyKey key, out DshPropVariant value);
    [PreserveSig] int SetValue(ref DshPropertyKey key, ref DshPropVariant value);
    [PreserveSig] int Commit();
}

public static class DshShortcutIdentity
{
    private const uint GpsReadWrite = 0x00000002;
    private static readonly Guid AppUserModelIdKeyFormat = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetPropertyStoreFromParsingName(
        string path,
        IntPtr bindContext,
        uint flags,
        ref Guid interfaceId,
        out DshPropertyStore propertyStore);

    public static void Set(string path, string appUserModelId)
    {
        var interfaceId = typeof(DshPropertyStore).GUID;
        DshPropertyStore propertyStore;
        var result = SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, GpsReadWrite, ref interfaceId, out propertyStore);
        Marshal.ThrowExceptionForHR(result);

        var key = new DshPropertyKey(AppUserModelIdKeyFormat, 5);
        var value = DshPropVariant.FromString(appUserModelId);
        try
        {
            Marshal.ThrowExceptionForHR(propertyStore.SetValue(ref key, ref value));
            Marshal.ThrowExceptionForHR(propertyStore.Commit());
        }
        finally
        {
            value.Free();
            Marshal.ReleaseComObject(propertyStore);
        }
    }
}
'@

$shell = New-Object -ComObject WScript.Shell
try {
  foreach ($path in $ShortcutPath) {
    $parent = Split-Path -Parent $path
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }

    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = Split-Path -Parent $target
    $shortcut.IconLocation = "$icon,0"
    $shortcut.Description = 'DeepSeek Harness'
    $shortcut.Save()
    [DshShortcutIdentity]::Set($path, $AppUserModelId)
    Write-Output "Updated shortcut: $path"
  }
}
finally {
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}
