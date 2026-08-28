<?php

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if (str_starts_with($path, '/api/')) {
    $_GET['route'] = substr($path, 5);
    require __DIR__ . '/api/index.php';
    return true;
}
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) return false;
readfile(__DIR__ . '/index.html');
return true;

