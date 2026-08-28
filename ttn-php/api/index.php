<?php

declare(strict_types=1);

ini_set('display_errors', '0');
date_default_timezone_set('Asia/Bangkok');

const SESSION_COOKIE = 'ttime_php_session';
const SESSION_SECONDS = 43200;
const VALID_ROLES = ['user', 'admin', 'hr', 'employee-driver', 'employee-office'];

function respond(array $data = [], int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => $status < 400] + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $error, ?int $status = null): never
{
    $conflicts = ['username_exists', 'already_checked_in', 'already_checked_out', 'duplicate_work_date'];
    $unavailable = ['backend_not_configured', 'backend_unavailable', 'backend_invalid_response'];
    $status ??= in_array($error, $conflicts, true) ? 409
        : (in_array($error, $unavailable, true) ? 503
        : ($error === 'account_disabled' || $error === 'forbidden' ? 403
        : ($error === 'unauthorized' ? 401 : ($error === 'photo_not_found' ? 404 : 400))));
    respond(['error' => $error], $status);
}

set_exception_handler(function (Throwable $error): void {
    error_log('[T TIME PHP] ' . $error->getMessage());
    fail('server_error', 500);
});

function env_required(string $name): string
{
    $value = trim((string) getenv($name));
    if ($value === '') {
        throw new RuntimeException($name === 'SESSION_SECRET' ? 'session_not_configured' : 'backend_not_configured');
    }
    return $value;
}

function b64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function b64url_decode(string $value): string|false
{
    $padding = strlen($value) % 4;
    if ($padding) $value .= str_repeat('=', 4 - $padding);
    return base64_decode(strtr($value, '-_', '+/'), true);
}

function normalize_role(mixed $role): string
{
    $value = strtolower(str_replace('_', '-', trim((string) $role)));
    if (in_array($value, ['driver', 'shipping', 'employee-shipping'], true)) $value = 'employee-driver';
    if ($value === 'office') $value = 'employee-office';
    return in_array($value, VALID_ROLES, true) ? $value : 'user';
}

function public_user(array $user): array
{
    return [
        'id' => (string) ($user['id'] ?? ''),
        'username' => (string) ($user['username'] ?? ''),
        'name' => (string) ($user['name'] ?? ''),
        'role' => normalize_role($user['role'] ?? 'user'),
        'active' => (bool) ($user['active'] ?? false),
    ];
}

function session_token(array $user): string
{
    $payload = b64url_encode(json_encode([
        'user' => public_user($user),
        'exp' => time() + SESSION_SECONDS,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $signature = hash_hmac('sha256', $payload, env_required('SESSION_SECRET'), true);
    return $payload . '.' . b64url_encode($signature);
}

function set_session(array $user): void
{
    $secure = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? 'https')) === 'https';
    setcookie(SESSION_COOKIE, session_token($user), [
        'expires' => time() + SESSION_SECONDS,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clear_session(): void
{
    setcookie(SESSION_COOKIE, '', [
        'expires' => 1,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function current_user(): ?array
{
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    [$payload, $signature] = array_pad(explode('.', $token, 2), 2, '');
    if ($payload === '' || $signature === '') return null;
    $actual = b64url_decode($signature);
    if ($actual === false) return null;
    $expected = hash_hmac('sha256', $payload, env_required('SESSION_SECRET'), true);
    if (!hash_equals($expected, $actual)) return null;
    $decoded = b64url_decode($payload);
    $data = $decoded === false ? null : json_decode($decoded, true);
    if (!is_array($data) || (int) ($data['exp'] ?? 0) <= time() || !is_array($data['user'] ?? null)) return null;
    $user = public_user($data['user']);
    return $user['id'] !== '' && $user['active'] ? $user : null;
}

function require_user(): array
{
    return current_user() ?? fail('unauthorized', 401);
}

function require_role(array $user, string ...$roles): void
{
    if (!in_array($user['role'], $roles, true)) fail('forbidden', 403);
}

function verify_origin(): void
{
    if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD', 'OPTIONS'], true)) return;
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') return;
    $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
    $requestHost = strtolower(explode(':', (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? ''))[0]);
    if ($originHost === '' || !hash_equals($requestHost, $originHost)) fail('forbidden', 403);
}

function json_input(): array
{
    $decoded = json_decode((string) file_get_contents('php://input'), true);
    return is_array($decoded) ? $decoded : [];
}

function backend(string $action, array $payload = []): array
{
    $url = env_required('GOOGLE_APPS_SCRIPT_URL');
    $body = json_encode(array_merge($payload, [
        'action' => $action,
        'token' => env_required('GOOGLE_APPS_SCRIPT_TOKEN'),
    ]), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 55,
        CURLOPT_ENCODING => '',
    ]);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);
    if ($raw === false || $status < 200 || $status >= 300) {
        error_log('[T TIME PHP] backend request failed: ' . ($curlError ?: 'HTTP ' . $status));
        throw new RuntimeException('backend_unavailable');
    }
    $result = json_decode($raw, true);
    if (!is_array($result)) throw new RuntimeException('backend_invalid_response');
    if (($result['ok'] ?? false) !== true) fail((string) ($result['error'] ?? 'backend_error'));
    return $result;
}

function public_attendance(array $row): array
{
    $checkInFile = (string) ($row['check_in_file_id'] ?? '');
    $checkOutFile = (string) ($row['check_out_file_id'] ?? '');
    unset($row['check_in_file_id'], $row['check_out_file_id']);
    $row['check_in_photo_url'] = '/api/photo?id=' . rawurlencode($checkInFile);
    $row['check_out_photo_url'] = $checkOutFile !== '' ? '/api/photo?id=' . rawurlencode($checkOutFile) : null;
    return $row;
}

function local_time_to_iso(mixed $value): ?string
{
    $local = trim((string) $value);
    $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $local, new DateTimeZone('Asia/Bangkok'));
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || (is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) return null;
    return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.000\Z');
}

verify_origin();
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$route = trim((string) ($_GET['route'] ?? ''), '/');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($route === 'health' && $method === 'GET') {
    backend('status');
    respond(['service' => 'T TIME PHP API', 'runtime' => PHP_VERSION, 'backend' => 'connected']);
}

if ($route === 'session' && $method === 'GET') {
    respond(['user' => current_user(), 'needsSetup' => false]);
}

if ($route === 'login' && $method === 'POST') {
    $input = json_input();
    $username = strtolower(trim((string) ($input['username'] ?? '')));
    $password = (string) ($input['password'] ?? '');
    if ($username === '' || $password === '') fail('missing_credentials');
    $result = backend('findUser', ['username' => $username]);
    $stored = is_array($result['user'] ?? null) ? $result['user'] : null;
    if (!$stored || !(bool) ($stored['active'] ?? false)) fail($stored ? 'account_disabled' : 'invalid_credentials', $stored ? 403 : 401);
    $salt = @hex2bin((string) ($stored['passwordSalt'] ?? ''));
    if ($salt === false) fail('invalid_credentials', 401);
    $hash = hash_pbkdf2('sha256', $password, $salt, 120000, 64, false);
    if (!hash_equals((string) ($stored['passwordHash'] ?? ''), $hash)) fail('invalid_credentials', 401);
    $user = public_user($stored);
    set_session($user);
    respond(['user' => $user]);
}

if ($route === 'logout' && $method === 'POST') {
    clear_session();
    respond();
}

if ($route === 'attendance' && $method === 'GET') {
    $user = require_user();
    $all = in_array($user['role'], ['admin', 'hr'], true) && ($_GET['scope'] ?? '') === 'all';
    $result = backend('listAttendance', [
        'userId' => $all ? '' : $user['id'],
        'todayUserId' => $user['id'],
        'limit' => $all ? 250 : 120,
    ]);
    $rows = array_map('public_attendance', is_array($result['rows'] ?? null) ? $result['rows'] : []);
    $today = is_array($result['today'] ?? null) ? public_attendance($result['today']) : null;
    respond(['rows' => $rows, 'today' => $today, 'scope' => $all ? 'all' : 'mine']);
}

if ($route === 'attendance' && $method === 'POST') {
    $user = require_user();
    $action = trim((string) ($_POST['action'] ?? ''));
    if (!in_array($action, ['check-in', 'check-out'], true)) fail('invalid_action');
    $file = $_FILES['photo'] ?? null;
    if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) fail('photo_required');
    if ((int) ($file['size'] ?? 0) > 8 * 1024 * 1024) fail('photo_too_large');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file((string) $file['tmp_name']) ?: '';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) fail('invalid_photo_type');
    $lat = filter_var($_POST['lat'] ?? null, FILTER_VALIDATE_FLOAT);
    $lng = filter_var($_POST['lng'] ?? null, FILTER_VALIDATE_FLOAT);
    if ($lat === false || $lng === false || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) fail('location_required');
    backend('recordAttendance', [
        'attendanceAction' => $action,
        'userId' => $user['id'],
        'photoBase64' => base64_encode((string) file_get_contents((string) $file['tmp_name'])),
        'mimeType' => $mime,
        'lat' => $lat,
        'lng' => $lng,
        'accuracy' => max(0, (float) ($_POST['accuracy'] ?? 0)),
        'deviceTime' => (string) ($_POST['device_time'] ?? ''),
    ]);
    respond(['action' => $action], 201);
}

if ($route === 'attendance' && $method === 'PATCH') {
    $user = require_user();
    require_role($user, 'hr');
    $input = json_input();
    $id = trim((string) ($input['id'] ?? ''));
    $checkInAt = local_time_to_iso($input['checkInAt'] ?? null);
    $hasCheckOut = trim((string) ($input['checkOutAt'] ?? '')) !== '';
    $checkOutAt = $hasCheckOut ? local_time_to_iso($input['checkOutAt']) : null;
    if ($id === '' || !$checkInAt || ($hasCheckOut && !$checkOutAt)) fail('invalid_datetime');
    if ($checkOutAt && strtotime($checkOutAt) < strtotime($checkInAt)) fail('check_out_before_check_in');
    backend('updateAttendance', array_filter([
        'id' => $id,
        'checkInAt' => $checkInAt,
        'checkOutAt' => $checkOutAt,
    ], static fn ($value) => $value !== null));
    respond();
}

if ($route === 'users' && $method === 'GET') {
    $user = require_user();
    require_role($user, 'admin');
    $result = backend('listUsers');
    respond(['users' => $result['users'] ?? []]);
}

if ($route === 'users' && $method === 'POST') {
    $user = require_user();
    require_role($user, 'admin');
    $input = json_input();
    $username = trim((string) ($input['username'] ?? ''));
    $name = trim((string) ($input['name'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    $role = normalize_role($input['role'] ?? 'user');
    if (strlen($username) < 3 || !preg_match('/^[A-Za-z0-9._-]+$/', $username)) fail('invalid_username');
    if (mb_strlen($name) < 2) fail('invalid_name');
    if (strlen($password) < 8) fail('password_too_short');
    $saltHex = bin2hex(random_bytes(16));
    $hash = hash_pbkdf2('sha256', $password, hex2bin($saltHex), 120000, 64, false);
    $result = backend('createUser', ['user' => [
        'username' => $username,
        'name' => $name,
        'role' => $role,
        'passwordSalt' => $saltHex,
        'passwordHash' => $hash,
    ]]);
    respond(['user' => $result['user'] ?? null], 201);
}

if ($route === 'photo' && $method === 'GET') {
    $user = require_user();
    $fileId = trim((string) ($_GET['id'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{10,}$/', $fileId)) fail('invalid_photo_key');
    $result = backend('getPhoto', ['fileId' => $fileId]);
    if (($result['ownerUserId'] ?? '') !== $user['id'] && !in_array($user['role'], ['admin', 'hr'], true)) fail('forbidden', 403);
    $bytes = base64_decode((string) ($result['base64'] ?? ''), true);
    if ($bytes === false) fail('photo_not_found', 404);
    header('Content-Type: ' . ((string) ($result['mimeType'] ?? 'image/jpeg')));
    header('Cache-Control: private, max-age=300');
    header('X-Content-Type-Options: nosniff');
    echo $bytes;
    exit;
}

fail('not_found', 404);
