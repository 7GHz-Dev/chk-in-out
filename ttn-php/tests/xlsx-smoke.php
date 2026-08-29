<?php

declare(strict_types=1);

$source = (string) file_get_contents(__DIR__ . '/../api/index.php');
$prefix = explode("\nverify_origin();", $source, 2)[0];
eval(substr($prefix, 5));
restore_exception_handler();

$_SERVER['HTTP_HOST'] = 'localhost:8000';
$_SERVER['HTTP_X_FORWARDED_PROTO'] = 'http';

$expectedDate = (new DateTimeImmutable('2026-08-29 00:00:00', new DateTimeZone('UTC')))->getTimestamp() / 86400 + 25569;
$expectedBangkokTime = (new DateTimeImmutable('2026-08-29 08:00:00', new DateTimeZone('UTC')))->getTimestamp() / 86400 + 25569;
if (abs((float) xlsx_date_serial('2026-08-29', true) - $expectedDate) > 0.000001) throw new RuntimeException('Date serial shifted timezone');
if (abs((float) xlsx_date_serial('2026-08-29T01:00:00.000Z') - $expectedBangkokTime) > 0.000001) throw new RuntimeException('Datetime serial is not Bangkok wall-clock time');
if (xlsx_xml("A\x01B") !== 'AB') throw new RuntimeException('XML control characters were not removed');

$rows = [[
    'id' => 'attendance-1', 'user_id' => 'user-1', 'username' => 'employee',
    'name' => 'ทดสอบ ระบบ', 'role' => 'employee-office', 'work_date' => '2026-08-29',
    'check_in_at' => '2026-08-29T01:00:00.000Z', 'check_out_at' => '2026-08-29T10:00:00.000Z',
    'check_in_lat' => 13.7563, 'check_in_lng' => 100.5018, 'check_in_accuracy' => 12,
    'check_in_file_id' => 'checkin-file-123', 'check_out_lat' => 13.75, 'check_out_lng' => 100.5,
    'check_out_accuracy' => 15, 'check_out_file_id' => 'checkout-file-123',
    'updated_at' => '2026-08-29T10:00:00.000Z',
]];
$filters = ['from' => '2026-08-01', 'to' => '2026-08-31', 'role' => '', 'status' => '', 'search' => ''];
$binary = xlsx_workbook($rows, $filters);
$path = tempnam(sys_get_temp_dir(), 'ttime_xlsx_test_');
if ($path === false || file_put_contents($path, $binary) === false) throw new RuntimeException('Cannot write test workbook');

$zip = new ZipArchive();
if ($zip->open($path) !== true) throw new RuntimeException('Generated XLSX is not a ZIP archive');
$required = [
    '[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml',
];
foreach ($required as $name) {
    if ($zip->locateName($name) === false) throw new RuntimeException('Missing XLSX entry: ' . $name);
    $xml = $zip->getFromName($name);
    if (!is_string($xml) || simplexml_load_string($xml) === false) throw new RuntimeException('Invalid XML: ' . $name);
}
$workbookXml = (string) $zip->getFromName('xl/workbook.xml');
if (!str_contains($workbookXml, 'Attendance Details')) throw new RuntimeException('Missing detail sheet');
if (!str_contains($workbookXml, 'Employee Summary')) throw new RuntimeException('Missing employee summary sheet');
$employeeXml = (string) $zip->getFromName('xl/worksheets/sheet3.xml');
if (!str_contains($employeeXml, 'ชื่อ–นามสกุล')) throw new RuntimeException('Employee sheet is missing its header');
if (!str_contains($employeeXml, 'รวมทั้งหมด 1 คน')) throw new RuntimeException('Employee sheet is missing its totals row');
$summary = report_employee_summary($rows);
if (count($summary) !== 1 || $summary[0]['days'] !== 1 || abs($summary[0]['total_hours'] - 9) > 0.0001) throw new RuntimeException('Employee summary totals are wrong');
$entries = $zip->numFiles;
$zip->close();
unlink($path);

$fallbackPath = tempnam(sys_get_temp_dir(), 'ttime_zip_test_');
if ($fallbackPath === false || file_put_contents($fallbackPath, zip_store(['hello.txt' => 'T TIME'])) === false) throw new RuntimeException('Cannot write fallback ZIP');
$fallbackZip = new ZipArchive();
if ($fallbackZip->open($fallbackPath) !== true || $fallbackZip->getFromName('hello.txt') !== 'T TIME') throw new RuntimeException('Manual ZIP fallback is invalid');
$fallbackZip->close();
unlink($fallbackPath);

echo 'xlsx-ok entries=' . $entries . ' bytes=' . strlen($binary) . PHP_EOL;
