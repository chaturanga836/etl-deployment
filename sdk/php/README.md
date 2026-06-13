# elt-sdk (PHP)

HTTP client for the ELT Engine API. Use in Laravel or any PHP 8.1+ app.

```bash
composer require elt/sdk
```

```php
use Elt\Sdk\EltClient;

$client = new EltClient('https://api.example.com', fn () => $bearerToken);
$projects = $client->listProjects();
```
