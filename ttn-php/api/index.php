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

function valid_date_key(mixed $value): string
{
    $key = trim((string) $value);
    if ($key === '') return '';
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $key, new DateTimeZone('Asia/Bangkok'));
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || $date->format('Y-m-d') !== $key || (is_array($errors) && ($errors['warning_count'] || $errors['error_count']))) fail('invalid_report_filters');
    return $key;
}

function report_filters(): array
{
    $from = valid_date_key($_GET['from'] ?? '');
    $to = valid_date_key($_GET['to'] ?? '');
    if ($from !== '' && $to !== '' && $from > $to) fail('invalid_report_filters');
    $role = strtolower(str_replace('_', '-', trim((string) ($_GET['role'] ?? ''))));
    if ($role !== '' && !in_array($role, VALID_ROLES, true)) fail('invalid_report_filters');
    $status = trim(strtolower((string) ($_GET['status'] ?? '')));
    if (!in_array($status, ['', 'complete', 'working'], true)) fail('invalid_report_filters');
    $search = trim((string) ($_GET['search'] ?? ''));
    if (mb_strlen($search) > 100) $search = mb_substr($search, 0, 100);
    return ['from' => $from, 'to' => $to, 'role' => $role, 'status' => $status, 'search' => $search];
}

function filter_report_rows(array $rows, array $filters): array
{
    $needle = mb_strtolower($filters['search'], 'UTF-8');
    return array_values(array_filter($rows, static function ($row) use ($filters, $needle): bool {
        if (!is_array($row)) return false;
        $workDate = (string) ($row['work_date'] ?? '');
        if ($filters['from'] !== '' && $workDate < $filters['from']) return false;
        if ($filters['to'] !== '' && $workDate > $filters['to']) return false;
        if ($filters['role'] !== '' && normalize_role($row['role'] ?? '') !== $filters['role']) return false;
        $complete = trim((string) ($row['check_out_at'] ?? '')) !== '';
        if ($filters['status'] === 'complete' && !$complete) return false;
        if ($filters['status'] === 'working' && $complete) return false;
        if ($needle !== '') {
            $haystack = mb_strtolower(implode(' ', [
                (string) ($row['name'] ?? ''), (string) ($row['username'] ?? ''),
                normalize_role($row['role'] ?? ''), $workDate,
            ]), 'UTF-8');
            if (!str_contains($haystack, $needle)) return false;
        }
        return true;
    }));
}

function report_work_minutes(array $row): ?int
{
    try {
        $checkInText = trim((string) ($row['check_in_at'] ?? ''));
        $checkOutText = trim((string) ($row['check_out_at'] ?? ''));
        if ($checkInText === '' || $checkOutText === '') return null;
        $checkIn = new DateTimeImmutable($checkInText);
        $checkOut = new DateTimeImmutable($checkOutText);
        $seconds = $checkOut->getTimestamp() - $checkIn->getTimestamp();
        return $seconds >= 0 ? (int) round($seconds / 60) : null;
    } catch (Throwable) {
        return null;
    }
}

function request_base_url(): string
{
    $proto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? 'https'))[0]));
    if (!in_array($proto, ['http', 'https'], true)) $proto = 'https';
    $host = trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? 'localhost'))[0]);
    if (!preg_match('/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/', $host)) $host = 'localhost';
    return $proto . '://' . $host;
}

function xlsx_xml(mixed $value): string
{
    $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string) $value);
    return htmlspecialchars($clean ?? '', ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function xlsx_column(int $number): string
{
    $name = '';
    while ($number > 0) {
        $number--;
        $name = chr(65 + ($number % 26)) . $name;
        $number = intdiv($number, 26);
    }
    return $name;
}

function xlsx_text_cell(int $column, int $row, mixed $value, int $style = 12): string
{
    $reference = xlsx_column($column) . $row;
    return '<c r="' . $reference . '" s="' . $style . '" t="inlineStr"><is><t xml:space="preserve">' . xlsx_xml($value) . '</t></is></c>';
}

function xlsx_number_cell(int $column, int $row, float|int|null $value, int $style = 8): string
{
    if ($value === null) return xlsx_text_cell($column, $row, '', 12);
    return '<c r="' . xlsx_column($column) . $row . '" s="' . $style . '"><v>' . rtrim(rtrim(number_format((float) $value, 8, '.', ''), '0'), '.') . '</v></c>';
}

function xlsx_date_serial(mixed $value, bool $dateOnly = false): ?float
{
    $text = trim((string) $value);
    if ($text === '') return null;
    try {
        $date = $dateOnly
            ? new DateTimeImmutable($text . 'T00:00:00', new DateTimeZone('Asia/Bangkok'))
            : (new DateTimeImmutable($text))->setTimezone(new DateTimeZone('Asia/Bangkok'));
        $wallClock = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $date->format('Y-m-d H:i:s'), new DateTimeZone('UTC'));
        return $wallClock ? ($wallClock->getTimestamp() / 86400) + 25569 : null;
    } catch (Throwable) {
        return null;
    }
}

function xlsx_row(int $row, array $cells, ?float $height = null): string
{
    $attributes = ' r="' . $row . '"';
    if ($height !== null) $attributes .= ' ht="' . $height . '" customHeight="1"';
    return '<row' . $attributes . '>' . implode('', $cells) . '</row>';
}

function report_role_label(string $role): string
{
    return match (normalize_role($role)) {
        'admin' => 'ผู้ดูแลระบบ',
        'hr' => 'ฝ่ายบุคคล',
        'employee-driver' => 'พนักงานขับรถ',
        'employee-office' => 'พนักงานออฟฟิศ',
        default => 'ผู้ใช้งาน',
    };
}

function report_filter_label(array $filters): string
{
    $period = ($filters['from'] ?: 'ทั้งหมด') . ' ถึง ' . ($filters['to'] ?: 'ทั้งหมด');
    $role = $filters['role'] === '' ? 'ทุกบทบาท' : report_role_label($filters['role']);
    $status = match ($filters['status']) { 'complete' => 'บันทึกครบ', 'working' => 'ยังไม่เลิกงาน', default => 'ทุกสถานะ' };
    return 'ช่วงวันที่: ' . $period . ' | บทบาท: ' . $role . ' | สถานะ: ' . $status . ($filters['search'] !== '' ? ' | ค้นหา: ' . $filters['search'] : '');
}

function xlsx_summary_sheet(array $rows, array $filters): string
{
    $completed = array_values(array_filter($rows, static fn ($row) => trim((string) ($row['check_out_at'] ?? '')) !== ''));
    $employees = [];
    $totalMinutes = 0;
    foreach ($rows as $row) {
        $employees[(string) ($row['user_id'] ?? $row['username'] ?? '')] = true;
        $totalMinutes += report_work_minutes($row) ?? 0;
    }
    unset($employees['']);
    $averageHours = count($completed) ? ($totalMinutes / count($completed) / 60) : 0;
    $roleCounts = [];
    foreach ($rows as $row) {
        $label = report_role_label((string) ($row['role'] ?? 'user'));
        $roleCounts[$label] = ($roleCounts[$label] ?? 0) + 1;
    }
    ksort($roleCounts, SORT_NATURAL);
    $sheetCells = [];
    $sheetCells[1] = [xlsx_text_cell(1, 1, 'T TIME — รายงานการลงเวลาพนักงาน', 1)];
    $sheetCells[2] = [xlsx_text_cell(1, 2, report_filter_label($filters), 11)];
    $sheetCells[3] = [xlsx_text_cell(1, 3, 'จัดทำเมื่อ ' . (new DateTimeImmutable('now', new DateTimeZone('Asia/Bangkok')))->format('d/m/Y H:i') . ' น.', 11)];
    $sheetCells[5] = [xlsx_text_cell(1, 5, 'ตัวชี้วัดหลัก', 2), xlsx_text_cell(4, 5, 'สรุปตามบทบาท', 2)];
    $sheetCells[6] = [xlsx_text_cell(1, 6, 'ตัวชี้วัด', 3), xlsx_text_cell(2, 6, 'ผลรวม', 3), xlsx_text_cell(4, 6, 'บทบาท', 3), xlsx_text_cell(5, 6, 'รายการ', 3)];
    $metrics = [
        ['รายการลงเวลาทั้งหมด', count($rows), 5], ['จำนวนพนักงาน', count($employees), 5],
        ['รายการบันทึกครบ', count($completed), 5], ['รายการยังไม่เลิกงาน', count($rows) - count($completed), 5],
        ['ชั่วโมงทำงานรวม', $totalMinutes / 60, 8], ['ชั่วโมงเฉลี่ยต่อรายการที่ครบ', $averageHours, 8],
    ];
    $rowNumber = 7;
    foreach ($metrics as [$label, $value, $style]) {
        $sheetCells[$rowNumber] = [xlsx_text_cell(1, $rowNumber, $label, 4), xlsx_number_cell(2, $rowNumber, $value, $style)];
        $rowNumber++;
    }
    $roleRow = 7;
    foreach ($roleCounts as $label => $count) {
        $sheetCells[$roleRow] = array_merge($sheetCells[$roleRow] ?? [], [xlsx_text_cell(4, $roleRow, $label, 4), xlsx_number_cell(5, $roleRow, $count, 5)]);
        $roleRow++;
    }
    ksort($sheetCells, SORT_NUMERIC);
    $sheetRows = [];
    foreach ($sheetCells as $number => $cells) $sheetRows[] = xlsx_row((int) $number, $cells, in_array((int) $number, [1, 5], true) ? 28 : null);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        . '<cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="4" customWidth="1"/><col min="4" max="4" width="32" customWidth="1"/><col min="5" max="5" width="15" customWidth="1"/></cols>'
        . '<sheetData>' . implode('', $sheetRows) . '</sheetData><mergeCells count="3"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/><mergeCell ref="A3:H3"/></mergeCells><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}

/** จัดกลุ่มรายการลงเวลาเป็นรายคน — ชีตที่ฝ่ายบุคคลใช้ตั้งต้นคิดวันทำงานและชั่วโมงรวม */
function report_employee_summary(array $rows): array
{
    $groups = [];
    foreach ($rows as $row) {
        if (!is_array($row)) continue;
        $key = (string) ($row['user_id'] ?? '') ?: (string) ($row['username'] ?? '') ?: (string) ($row['name'] ?? '');
        $groups[$key][] = $row;
    }
    $summaries = [];
    foreach ($groups as $group) {
        $dates = [];
        $records = 0;
        $completed = 0;
        $minutes = 0;
        $counted = 0;
        foreach ($group as $row) {
            $records++;
            $workDate = trim((string) ($row['work_date'] ?? ''));
            if ($workDate !== '') $dates[$workDate] = true;
            if (trim((string) ($row['check_out_at'] ?? '')) !== '') $completed++;
            $worked = report_work_minutes($row);
            if ($worked !== null) { $minutes += $worked; $counted++; }
        }
        ksort($dates, SORT_STRING);
        $keys = array_keys($dates);
        // แถวแรกของกลุ่มคือรายการล่าสุด ชื่อและบทบาทจึงเป็นค่าล่าสุดของคนนั้น
        $latest = $group[0];
        $summaries[] = [
            'user_id' => (string) ($latest['user_id'] ?? ''),
            'username' => (string) ($latest['username'] ?? ''),
            'name' => (string) ($latest['name'] ?? ''),
            'role' => report_role_label((string) ($latest['role'] ?? 'user')),
            'days' => count($keys),
            'records' => $records,
            'completed' => $completed,
            'open' => $records - $completed,
            'total_hours' => $minutes / 60,
            'average_hours' => $counted ? $minutes / $counted / 60 : null,
            'counted' => $counted,
            'first_date' => $keys[0] ?? '',
            'last_date' => $keys ? $keys[count($keys) - 1] : '',
        ];
    }
    usort($summaries, static fn ($left, $right) => strcmp($left['name'], $right['name']) ?: strcmp($left['username'], $right['username']));
    return $summaries;
}

function xlsx_employee_sheet(array $rows): string
{
    $headers = ['ลำดับ', 'รหัสพนักงาน', 'ชื่อผู้ใช้', 'ชื่อ–นามสกุล', 'บทบาท', 'จำนวนวันทำงาน', 'รายการลงเวลา', 'บันทึกครบ', 'ยังไม่เลิกงาน', 'ชั่วโมงรวม', 'ชั่วโมงเฉลี่ย/รายการ', 'ลงเวลาครั้งแรก', 'ลงเวลาล่าสุด'];
    $headerCells = [];
    foreach ($headers as $index => $header) $headerCells[] = xlsx_text_cell($index + 1, 1, $header, 3);
    $sheetRows = [xlsx_row(1, $headerCells, 30)];

    $summaries = report_employee_summary($rows);
    $totals = ['days' => 0, 'records' => 0, 'completed' => 0, 'open' => 0, 'hours' => 0.0, 'counted' => 0];
    $rowNumber = 2;
    foreach ($summaries as $index => $summary) {
        $totals['days'] += $summary['days'];
        $totals['records'] += $summary['records'];
        $totals['completed'] += $summary['completed'];
        $totals['open'] += $summary['open'];
        $totals['hours'] += $summary['total_hours'];
        $totals['counted'] += $summary['counted'];
        $sheetRows[] = xlsx_row($rowNumber, [
            xlsx_number_cell(1, $rowNumber, $index + 1, 5),
            xlsx_text_cell(2, $rowNumber, $summary['user_id']),
            xlsx_text_cell(3, $rowNumber, $summary['username']),
            xlsx_text_cell(4, $rowNumber, $summary['name']),
            xlsx_text_cell(5, $rowNumber, $summary['role']),
            xlsx_number_cell(6, $rowNumber, $summary['days'], 5),
            xlsx_number_cell(7, $rowNumber, $summary['records'], 5),
            xlsx_number_cell(8, $rowNumber, $summary['completed'], 5),
            xlsx_number_cell(9, $rowNumber, $summary['open'], 5),
            xlsx_number_cell(10, $rowNumber, $summary['total_hours'], 8),
            xlsx_number_cell(11, $rowNumber, $summary['average_hours'], 8),
            xlsx_number_cell(12, $rowNumber, xlsx_date_serial($summary['first_date'], true), 6),
            xlsx_number_cell(13, $rowNumber, xlsx_date_serial($summary['last_date'], true), 6),
        ], 26);
        $rowNumber++;
    }

    if ($summaries) {
        $sheetRows[] = xlsx_row($rowNumber, [
            xlsx_text_cell(1, $rowNumber, 'รวมทั้งหมด ' . count($summaries) . ' คน', 10),
            xlsx_text_cell(2, $rowNumber, '', 10), xlsx_text_cell(3, $rowNumber, '', 10),
            xlsx_text_cell(4, $rowNumber, '', 10), xlsx_text_cell(5, $rowNumber, '', 10),
            xlsx_number_cell(6, $rowNumber, $totals['days'], 5),
            xlsx_number_cell(7, $rowNumber, $totals['records'], 5),
            xlsx_number_cell(8, $rowNumber, $totals['completed'], 5),
            xlsx_number_cell(9, $rowNumber, $totals['open'], 5),
            xlsx_number_cell(10, $rowNumber, $totals['hours'], 8),
            xlsx_number_cell(11, $rowNumber, $totals['counted'] ? $totals['hours'] / $totals['counted'] : null, 8),
            xlsx_text_cell(12, $rowNumber, '', 10), xlsx_text_cell(13, $rowNumber, '', 10),
        ], 27);
        $rowNumber++;
    }

    $lastRow = max(1, $rowNumber - 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="4" ySplit="1" topLeftCell="E2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
        . '<cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="3" width="19" customWidth="1"/><col min="4" max="4" width="27" customWidth="1"/><col min="5" max="5" width="22" customWidth="1"/><col min="6" max="11" width="17" customWidth="1"/><col min="12" max="13" width="18" customWidth="1"/></cols>'
        . '<sheetData>' . implode('', $sheetRows) . '</sheetData><autoFilter ref="A1:M' . $lastRow . '"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}

function xlsx_details_sheet(array $rows): string
{
    $headers = ['ลำดับ', 'วันที่ทำงาน', 'รหัสพนักงาน', 'ชื่อผู้ใช้', 'ชื่อ–นามสกุล', 'บทบาท', 'เวลาเข้างาน', 'เวลาเลิกงาน', 'ชั่วโมงทำงาน', 'สถานะ', 'GPS เข้า (เมตร)', 'แผนที่เข้างาน', 'รูปเข้างาน', 'GPS ออก (เมตร)', 'แผนที่เลิกงาน', 'รูปเลิกงาน', 'แก้ไขล่าสุด'];
    $sheetRows = [];
    $headerCells = [];
    foreach ($headers as $index => $header) $headerCells[] = xlsx_text_cell($index + 1, 1, $header, 3);
    $sheetRows[] = xlsx_row(1, $headerCells, 30);
    $baseUrl = request_base_url();
    $rowNumber = 2;
    foreach ($rows as $index => $record) {
        $minutes = report_work_minutes($record);
        $checkInLat = is_numeric($record['check_in_lat'] ?? null) ? (float) $record['check_in_lat'] : null;
        $checkInLng = is_numeric($record['check_in_lng'] ?? null) ? (float) $record['check_in_lng'] : null;
        $checkOutLat = is_numeric($record['check_out_lat'] ?? null) ? (float) $record['check_out_lat'] : null;
        $checkOutLng = is_numeric($record['check_out_lng'] ?? null) ? (float) $record['check_out_lng'] : null;
        $mapIn = $checkInLat !== null && $checkInLng !== null ? 'https://www.openstreetmap.org/?mlat=' . $checkInLat . '&mlon=' . $checkInLng . '#map=16/' . $checkInLat . '/' . $checkInLng : '';
        $mapOut = $checkOutLat !== null && $checkOutLng !== null ? 'https://www.openstreetmap.org/?mlat=' . $checkOutLat . '&mlon=' . $checkOutLng . '#map=16/' . $checkOutLat . '/' . $checkOutLng : '';
        $checkInFile = trim((string) ($record['check_in_file_id'] ?? ''));
        $checkOutFile = trim((string) ($record['check_out_file_id'] ?? ''));
        $photoIn = $checkInFile !== '' ? $baseUrl . '/api/photo?id=' . rawurlencode($checkInFile) : '';
        $photoOut = $checkOutFile !== '' ? $baseUrl . '/api/photo?id=' . rawurlencode($checkOutFile) : '';
        $complete = trim((string) ($record['check_out_at'] ?? '')) !== '';
        $cells = [
            xlsx_number_cell(1, $rowNumber, $index + 1, 5),
            xlsx_number_cell(2, $rowNumber, xlsx_date_serial($record['work_date'] ?? '', true), 6),
            xlsx_text_cell(3, $rowNumber, $record['user_id'] ?? ''),
            xlsx_text_cell(4, $rowNumber, $record['username'] ?? ''),
            xlsx_text_cell(5, $rowNumber, $record['name'] ?? ''),
            xlsx_text_cell(6, $rowNumber, report_role_label((string) ($record['role'] ?? 'user'))),
            xlsx_number_cell(7, $rowNumber, xlsx_date_serial($record['check_in_at'] ?? ''), 7),
            xlsx_number_cell(8, $rowNumber, xlsx_date_serial($record['check_out_at'] ?? ''), 7),
            xlsx_number_cell(9, $rowNumber, $minutes === null ? null : $minutes / 60, 8),
            xlsx_text_cell(10, $rowNumber, $complete ? 'บันทึกครบ' : 'ยังไม่เลิกงาน', $complete ? 9 : 10),
            xlsx_number_cell(11, $rowNumber, is_numeric($record['check_in_accuracy'] ?? null) ? (float) $record['check_in_accuracy'] : null, 8),
            xlsx_text_cell(12, $rowNumber, $mapIn, 13), xlsx_text_cell(13, $rowNumber, $photoIn, 13),
            xlsx_number_cell(14, $rowNumber, is_numeric($record['check_out_accuracy'] ?? null) ? (float) $record['check_out_accuracy'] : null, 8),
            xlsx_text_cell(15, $rowNumber, $mapOut, 13), xlsx_text_cell(16, $rowNumber, $photoOut, 13),
            xlsx_number_cell(17, $rowNumber, xlsx_date_serial($record['updated_at'] ?? ''), 7),
        ];
        $sheetRows[] = xlsx_row($rowNumber, $cells, 31);
        $rowNumber++;
    }
    $lastRow = max(1, $rowNumber - 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        . '<cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="4" width="19" customWidth="1"/><col min="5" max="5" width="27" customWidth="1"/><col min="6" max="6" width="22" customWidth="1"/><col min="7" max="8" width="20" customWidth="1"/><col min="9" max="11" width="16" customWidth="1"/><col min="12" max="16" width="42" customWidth="1"/><col min="17" max="17" width="20" customWidth="1"/></cols>'
        . '<sheetData>' . implode('', $sheetRows) . '</sheetData><autoFilter ref="A1:Q' . $lastRow . '"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}

function xlsx_styles(): string
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>'
        . '<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF10211C"/><sz val="11"/><name val="Calibri"/></font><font><i/><color rgb="FF6F7E78"/><sz val="10"/><name val="Calibri"/></font></fonts>'
        . '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF153C32"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFED5F42"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF1EC"/><bgColor indexed="64"/></patternFill></fill></fills>'
        . '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDDE3DC"/></left><right style="thin"><color rgb="FFDDE3DC"/></right><top style="thin"><color rgb="FFDDE3DC"/></top><bottom style="thin"><color rgb="FFDDE3DC"/></bottom><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="14">'
        . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0"/>'
        . '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0"/><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        . '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function zip_store(array $files): string
{
    $local = '';
    $central = '';
    $offset = 0;
    $now = getdate();
    $dosTime = (($now['hours'] & 31) << 11) | (($now['minutes'] & 63) << 5) | intdiv($now['seconds'], 2);
    $dosDate = ((max(1980, $now['year']) - 1980) << 9) | (($now['mon'] & 15) << 5) | ($now['mday'] & 31);
    foreach ($files as $name => $contents) {
        $name = str_replace('\\', '/', (string) $name);
        $contents = (string) $contents;
        $length = strlen($contents);
        $crc = crc32($contents);
        $header = pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, 0, $dosTime, $dosDate, $crc, $length, $length, strlen($name), 0);
        $local .= $header . $name . $contents;
        $central .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, 0, $dosTime, $dosDate, $crc, $length, $length, strlen($name), 0, 0, 0, 0, 0, $offset) . $name;
        $offset += strlen($header) + strlen($name) + $length;
    }
    return $local . $central . pack('VvvvvVVv', 0x06054b50, 0, 0, count($files), count($files), strlen($central), strlen($local), 0);
}

function xlsx_workbook(array $rows, array $filters): string
{
    $created = gmdate('Y-m-d\TH:i:s\Z');
    $files = [
        '[Content_Types].xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
        '_rels/.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
        'docProps/core.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>T TIME</dc:creator><dc:title>Attendance Report</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">' . $created . '</dcterms:created></cp:coreProperties>',
        'docProps/app.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>T TIME</Application><AppVersion>1.0</AppVersion></Properties>',
        'xl/workbook.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Employee Summary" sheetId="3" r:id="rId4"/><sheet name="Attendance Details" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029"/></workbook>',
        'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>',
        'xl/styles.xml' => xlsx_styles(),
        'xl/worksheets/sheet1.xml' => xlsx_summary_sheet($rows, $filters),
        'xl/worksheets/sheet2.xml' => xlsx_details_sheet($rows),
        'xl/worksheets/sheet3.xml' => xlsx_employee_sheet($rows),
    ];
    if (!class_exists('ZipArchive')) return zip_store($files);
    $path = tempnam(sys_get_temp_dir(), 'ttime_xlsx_');
    if ($path === false) throw new RuntimeException('xlsx_temp_failed');
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::OVERWRITE) !== true) throw new RuntimeException('xlsx_zip_failed');
    foreach ($files as $name => $contents) $zip->addFromString($name, $contents);
    $zip->close();
    $binary = file_get_contents($path);
    unlink($path);
    if ($binary === false) throw new RuntimeException('xlsx_read_failed');
    return $binary;
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
    $requestedLimit = (int) ($_GET['limit'] ?? ($all ? 250 : 120));
    $limit = $all ? max(1, min(5000, $requestedLimit)) : 120;
    $result = backend('listAttendance', [
        'userId' => $all ? '' : $user['id'],
        'todayUserId' => $user['id'],
        'limit' => $limit,
    ]);
    $rows = array_map('public_attendance', is_array($result['rows'] ?? null) ? $result['rows'] : []);
    $today = is_array($result['today'] ?? null) ? public_attendance($result['today']) : null;
    respond(['rows' => $rows, 'today' => $today, 'scope' => $all ? 'all' : 'mine']);
}

if ($route === 'report-data' && $method === 'GET') {
    $user = require_user();
    require_role($user, 'admin', 'hr');
    $result = backend('listAttendance', ['userId' => '', 'todayUserId' => $user['id'], 'limit' => 5000]);
    $rows = array_map('public_attendance', is_array($result['rows'] ?? null) ? $result['rows'] : []);
    respond(['rows' => $rows]);
}

if ($route === 'report' && $method === 'GET') {
    $user = require_user();
    require_role($user, 'admin', 'hr');
    $filters = report_filters();
    $result = backend('listAttendance', ['userId' => '', 'todayUserId' => $user['id'], 'limit' => 5000]);
    $rows = filter_report_rows(is_array($result['rows'] ?? null) ? $result['rows'] : [], $filters);
    $workbook = xlsx_workbook($rows, $filters);
    $from = $filters['from'] ?: 'ALL';
    $to = $filters['to'] ?: 'ALL';
    $filename = 'T-TIME_Attendance_' . $from . '_to_' . $to . '.xlsx';
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($workbook));
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    echo $workbook;
    exit;
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
