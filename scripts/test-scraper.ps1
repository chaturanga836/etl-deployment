# Quick scraper smoke test (local compose: scraper on port 8088)
param(
    [string]$ScraperBase = "http://localhost:8088",
    [string]$TargetUrl = "https://example.com"
)

$body = @{
    url = $TargetUrl
    extract = "text"
    wait_ms = 0
    render_js = $false
} | ConvertTo-Json

Write-Host "GET $ScraperBase/health"
curl.exe -s "$ScraperBase/health"
Write-Host ""

Write-Host "POST $ScraperBase/v1/scrape"
curl.exe -s -X POST "$ScraperBase/v1/scrape" `
    -H "Content-Type: application/json" `
    -d $body

Write-Host ""
