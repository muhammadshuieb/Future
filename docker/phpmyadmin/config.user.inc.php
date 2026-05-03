<?php

declare(strict_types=1);

/**
 * Plain-HTTP access (e.g. http://VPS_IP:8081) without TLS.
 * Otherwise PHP may emit Secure-only session cookies and browsers reject them over HTTP
 * ("Failed to set session cookie. Maybe you are using HTTP instead of HTTPS").
 */
$cfg['CookieSecure'] = false;
$cfg['ForceSSL'] = false;
ini_set('session.cookie_secure', '0');
