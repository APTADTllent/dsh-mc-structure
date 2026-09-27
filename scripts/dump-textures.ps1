# 把 PNG 贴图解成裸 RGBA 字节，好让 Node 侧也能"画"贴图
# ======================================================
# Node 没有内置的图像解码，但 .NET 的 System.Drawing 有。
# 这里把每张贴图导成一个 .rgba 文件（宽*高*4 字节，RGBA 顺序），
# 外加一份 manifest.json 记录每张的尺寸 —— Node 侧照着拼回去就行。
#
# 只处理【清单里列出的】那几张，不做目录遍历。
#
# 用法：powershell -File dump-textures.ps1 -List <清单.json> -Out <目录>
#   清单.json 形如：{ "dir": "C:\\...\\textures", "files": ["stone.png", ...] }
param(
  [Parameter(Mandatory = $true)][string]$List,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$spec = Get-Content -LiteralPath $List -Raw -Encoding UTF8 | ConvertFrom-Json
$dir = [string]$spec.dir
$want = @($spec.files)

New-Item -ItemType Directory -Force -Path $Out | Out-Null

$manifest = @{}
$done = 0

foreach ($f in $want) {
  if ([string]::IsNullOrWhiteSpace($f)) { continue }
  $src = Join-Path $dir $f
  if (-not (Test-Path -LiteralPath $src)) { continue }

  try {
    $bmp = New-Object System.Drawing.Bitmap($src)
    $w = $bmp.Width
    $h = $bmp.Height
    $buf = New-Object byte[] ($w * $h * 4)

    # LockBits 比逐点 GetPixel 快一个数量级
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $stride = $data.Stride
      $tmp = New-Object byte[] ($stride * $h)
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $tmp, 0, $tmp.Length)
      for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
          $si = $y * $stride + $x * 4          # BGRA
          $di = ($y * $w + $x) * 4             # 目标 RGBA
          $buf[$di] = $tmp[$si + 2]
          $buf[$di + 1] = $tmp[$si + 1]
          $buf[$di + 2] = $tmp[$si]
          $buf[$di + 3] = $tmp[$si + 3]
        }
      }
    }
    finally { $bmp.UnlockBits($data) }
    $bmp.Dispose()

    $safe = ($f -replace '[^\w\.\-]', '_')
    [System.IO.File]::WriteAllBytes((Join-Path $Out ($safe + '.rgba')), $buf)
    $manifest[$f] = @{ w = $w; h = $h; file = $safe + '.rgba' }
    $done++
  }
  catch {
    # 单张坏掉不该让整批失败
    Write-Warning "跳过 $f : $($_.Exception.Message)"
  }
}

$json = @{ dir = $dir; count = $done; textures = $manifest } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $Out 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "dumped $done textures to $Out"
