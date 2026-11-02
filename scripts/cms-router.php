<?php
// Router for PHP's built-in web server when trying a SiteForge WordPress theme or Drupal package locally.
// It mimics the usual Apache/nginx front-controller rules: real files are served directly and every other request
// goes to index.php, where the SiteForge theme/module serves generated images, feeds and pages.
//   php -S 127.0.0.1:8081 -t <wordpress folder> scripts/cms-router.php
//   cd <drupal>/web && php -S 127.0.0.1:8082 <siteforge>/scripts/cms-router.php
// Test use only: the built-in server is single-threaded and not meant for production.
$root = $_SERVER['DOCUMENT_ROOT'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path !== '/' && is_file($root . $path) && substr($path, -4) !== '.php') return false;
if (substr($path, -4) === '.php' && is_file($root . $path)) {
  $_SERVER['SCRIPT_NAME'] = $path;
  $_SERVER['SCRIPT_FILENAME'] = $root . $path;
  chdir(dirname($root . $path)); // as Apache does; Drupal's core/install.php relies on it
  require $root . $path;
  return;
}
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $root . '/index.php';
require $root . '/index.php';
