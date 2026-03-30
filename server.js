const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.md': 'text/plain; charset=utf-8',
};

// Extensions eligible for gzip compression
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.md']);

// Cache durations (seconds)
const CACHE_LONG = 60 * 60 * 24 * 7; // 7 days for images
const CACHE_SHORT = 60 * 5;           // 5 min for html/js/css

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
};

const server = http.createServer((req, res) => {
    // Only allow GET and HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Allow': 'GET, HEAD', ...SECURITY_HEADERS });
        res.end('Method Not Allowed');
        return;
    }

    // Strip query strings and decode
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    // Security: normalize and reject path traversal
    const normalized = path.normalize(urlPath);
    if (normalized.includes('..') || urlPath.includes('\0')) {
        res.writeHead(403, SECURITY_HEADERS);
        res.end('Forbidden');
        return;
    }

    let filePath = path.resolve(ROOT, '.' + normalized);
    if (urlPath === '/') filePath = path.resolve(ROOT, 'index.html');

    // Security: ensure resolved path is within ROOT
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
        res.writeHead(403, SECURITY_HEADERS);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.stat(filePath, (statErr, stats) => {
        // Reject directories and missing files uniformly as 404
        if (statErr || !stats.isFile()) {
            res.writeHead(404, SECURITY_HEADERS);
            res.end('Not Found');
            return;
        }

        const isImage = ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.ico';
        const cacheDuration = isImage ? CACHE_LONG : CACHE_SHORT;

        const headers = {
            'Content-Type': contentType,
            'Cache-Control': `public, max-age=${cacheDuration}`,
            ...SECURITY_HEADERS,
        };

        // Compress text-based responses if client supports it
        const acceptEncoding = req.headers['accept-encoding'] || '';
        if (COMPRESSIBLE.has(ext) && acceptEncoding.includes('gzip')) {
            headers['Content-Encoding'] = 'gzip';
            headers['Vary'] = 'Accept-Encoding';
            res.writeHead(200, headers);
            if (req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
        } else {
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(500, SECURITY_HEADERS);
                    res.end('Internal Server Error');
                    return;
                }
                headers['Content-Length'] = data.length;
                res.writeHead(200, headers);
                if (req.method === 'HEAD') { res.end(); return; }
                res.end(data);
            });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
