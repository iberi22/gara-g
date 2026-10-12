# DePIN Nodes API

Endpoints for interacting with DePIN mesh nodes (Sentinels and Gateways).

## List All Nodes
Returns a list of all active and inactive nodes in the network.

- **URL**: `/api/depin/nodes`
- **Method**: `GET`
- **Auth Required**: Yes

### Example Request
```bash
curl -X GET "https://gara-g.swal.network/api/depin/nodes" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response
- **Code**: 200 OK
- **Body**: Array of `DePinNode` objects.

```json
[
  {
    "id": "sentinel-01",
    "lat": 40.4168,
    "lng": -3.7038,
    "status": "online",
    "type": "sentinel",
    "peers": ["sentinel-02", "gateway-01"],
    "lastSeen": 1698400000000
  }
]
```

## Get Node Details
Returns detailed telemetry and metadata for a specific node.

- **URL**: `/api/depin/nodes/[id]`
- **Method**: `GET`
- **Path Parameters**:
  - `id`: The unique device ID of the node.

### Example Request
```bash
curl -X GET "https://gara-g.swal.network/api/depin/nodes/sentinel-01" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response
- **Code**: 200 OK
- **Body**: `DePinNodeDetail` object.

```json
{
  "deviceId": "sentinel-01",
  "firmwareVersion": "1.2.5",
  "status": "online",
  "lastHeartbeat": 1698400000000,
  "batteryLevel": 88,
  "signalStrength": -62,
  "connectedPeers": ["sentinel-02", "gateway-01"],
  "storageUsed": 14.2,
  "mode": "active",
  "location": {
    "lat": 40.4168,
    "lng": -3.7038
  }
}
```

## Register Node
Register a new physical node in the DePIN network by staking GARA tokens.

- **URL**: `/api/depin/nodes`
- **Method**: `POST`
- **Auth Required**: Yes

### Request Body
```json
{
  "deviceId": "sentinel-99",
  "stakeAmount": 100,
  "organizationId": "org-123"
}
```

### Example Request
```bash
curl -X POST "https://gara-g.swal.network/api/depin/nodes" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "sentinel-99", "stakeAmount": 100}'
```

### Response
- **Code**: 201 Created
- **Body**: Registration status and TX hash.

```json
{
  "success": true,
  "data": {
    "organizationId": "org-123",
    "deviceId": "sentinel-99",
    "status": "staked",
    "timestamp": "2023-10-27T10:00:00Z"
  }
}
```
