# DePIN Network API

Endpoints for retrieving global network statistics and mesh health.

## Network Statistics
Get aggregate metrics of the DePIN network.

- **URL**: `/api/depin/network-stats`
- **Method**: `GET`

### Example Request
```bash
curl -X GET "https://gara-g.swal.network/api/depin/network-stats"
```

### Response
- **Code**: 200 OK
```json
{
  "throughput": 48.2,
  "latency": 112,
  "packetLoss": 0.35,
  "activeNodes": 24,
  "totalData": 12.8,
  "networkHealth": 96,
  "timestamp": "2023-10-27T10:00:00Z"
}
```

## Network Metrics (Backend API)
Aggregated metrics from the core network monitoring services.

- **URL**: `/api/depin/stats`
- **Method**: `GET`

### Response
```json
{
  "success": true,
  "data": {
    "totalNodes": 150,
    "activeNodes": 124,
    "uptime": 99.98,
    "alerts": [],
    "timestamp": "2023-10-27T10:00:00Z"
  }
}
```
