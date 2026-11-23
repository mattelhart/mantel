param(
    [Parameter(Mandatory = $true)][string]$CertificateProfile,
    [string]$TizenCli = 'tizen.bat'
)
$ErrorActionPreference = 'Stop'
if (!(Get-Command $TizenCli -ErrorAction SilentlyContinue)) { throw 'Install Tizen Studio and Samsung TV extensions, or pass -TizenCli.' }
$stage = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Get-ChildItem -LiteralPath $stage -Filter '*.wgt' -File | Remove-Item
foreach ($name in @('config.xml', 'index.html', 'app.css', 'app.js', 'icon.png')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $stage -Force
}
& $TizenCli package -t wgt -s $CertificateProfile -- $stage
if ($LASTEXITCODE -ne 0) { throw 'Samsung signing failed. Check the certificate profile and target TV DUID.' }
Get-ChildItem -LiteralPath $stage -Filter '*.wgt'
