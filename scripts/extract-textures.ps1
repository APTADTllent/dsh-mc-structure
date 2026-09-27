# 从《我的世界》的版本 jar 里抽出方块贴图
# ========================================
# 为什么用 PowerShell 干这活：Node 自己不带 zip 解包，而 .NET 的
# System.IO.Compression 是现成的，还能【只抽匹配的条目】——
# 一个 25MB 的 jar 里方块贴图只占 300KB 左右，没必要整包解开。
#
# 用法：powershell -File extract-textures.ps1 -Jar <版本.jar> -Out <目标目录>
param(
  [Parameter(Mandatory = $true)][string]$Jar,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Jar)) { throw "找不到 jar：$Jar" }
Add-Type -AssemblyName System.IO.Compression.FileSystem

New-Item -ItemType Directory -Force -Path $Out | Out-Null

$zip = [System.IO.Compression.ZipFile]::OpenRead($Jar)
try {
  $n = 0
  $bytes = 0
  foreach ($e in $zip.Entries) {
    # Java 版 1.13 之后是 textures/block，之前是 textures/blocks，两个都认
    if ($e.FullName -match '^assets/minecraft/textures/blocks?/([^/]+\.png)$') {
      $dest = Join-Path $Out $Matches[1]
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
      $n++
      $bytes += $e.Length
    }
  }
  Write-Output "extracted $n png ($([math]::Round($bytes / 1KB)) KB) from $Jar"
}
finally {
  $zip.Dispose()
}
