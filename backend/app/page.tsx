/**
 * The backend is an API service; this page exists only so hitting the root in a browser
 * explains what the service is instead of returning a 404.
 */
export default function ServiceIndex() {
  const endpoints = [
    ['GET', '/api/health', 'Liveness probe and engine identification.'],
    ['POST', '/api/assets', 'Multipart upload. Decodes, extracts waveform peaks, returns metadata.'],
    ['GET', '/api/assets/:assetId', 'Metadata and peaks for a stored sample.'],
    ['POST', '/api/render', 'Project JSON in, 16-bit PCM WAV out.'],
  ];

  return (
    <main style={{ padding: '48px 32px', maxWidth: 820, lineHeight: 1.6 }}>
      <h1 style={{ color: '#5EE6A0', letterSpacing: '0.12em', fontSize: 22 }}>
        ◎ GreanTeaFX — RENDER SERVICE
      </h1>
      <p style={{ color: '#6B7A6F', fontSize: 13 }}>
        Spatial audio decoding, waveform peak extraction and offline HRTF mixdown. The
        interactive editor is a separate service and runs on port 3000 by default.
      </p>
      <table style={{ borderCollapse: 'collapse', marginTop: 28, fontSize: 13, width: '100%' }}>
        <tbody>
          {endpoints.map(([method, path, description]) => (
            <tr key={path} style={{ borderTop: '1px solid #22301F' }}>
              <td style={{ padding: '10px 14px 10px 0', color: '#E8A33D', whiteSpace: 'nowrap' }}>
                {method}
              </td>
              <td style={{ padding: '10px 14px 10px 0', color: '#D8E8DC', whiteSpace: 'nowrap' }}>
                {path}
              </td>
              <td style={{ padding: '10px 0', color: '#6B7A6F' }}>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
