from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_local_and_vercel_api_preflight():
    for origin in ('http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://dfab-quotation.vercel.app'):
        response = client.options('/api/analyze', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == origin

def test_direct_api_exposes_download_filename_header():
    response = client.get('/openapi.json', headers={'Origin':'http://localhost:3000'})
    assert response.status_code == 200
    assert 'content-disposition' in response.headers['access-control-expose-headers'].lower()
