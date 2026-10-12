import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

/// Service for storing and retrieving vehicle metadata from IPFS
class IpfsService {
  // Using public gateways - replace with your own Pinata/Infura in production
  static const String _uploadEndpoint = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
  static const String _gateway = 'https://gateway.pinata.cloud/ipfs/';

  final String? _apiKey;
  final String? _apiSecret;

  IpfsService({String? apiKey, String? apiSecret})
      : _apiKey = apiKey,
        _apiSecret = apiSecret;

  /// Upload vehicle metadata to IPFS
  Future<String> uploadVehicleMetadata(VehicleMetadata metadata) async {
    final json = metadata.toJson();

    final response = await http.post(
      Uri.parse(_uploadEndpoint),
      headers: {
        'Content-Type': 'application/json',
        if (_apiKey != null) 'pinata_api_key': _apiKey,
        if (_apiSecret != null) 'pinata_secret_api_key': _apiSecret,
      },
      body: jsonEncode({
        'pinataContent': json,
        'pinataMetadata': {
          'name': 'vehicle-${metadata.vin ?? DateTime.now().millisecondsSinceEpoch}',
        },
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return 'ipfs://${data['IpfsHash']}';
    } else {
      throw Exception('Failed to upload to IPFS: ${response.body}');
    }
  }

  /// Fetch vehicle metadata from IPFS
  Future<VehicleMetadata> fetchVehicleMetadata(String ipfsUri) async {
    final cid = ipfsUri.replaceFirst('ipfs://', '');
    final url = '$_gateway$cid';

    final response = await http.get(Uri.parse(url));

    if (response.statusCode == 200) {
      return VehicleMetadata.fromJson(jsonDecode(response.body));
    } else {
      throw Exception('Failed to fetch from IPFS: ${response.statusCode}');
    }
  }

  /// Upload image to IPFS and return CID
  Future<String> uploadImage(Uint8List imageBytes, String filename) async {
    // For image uploads, use pinFileToIPFS endpoint
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('https://api.pinata.cloud/pinning/pinFileToIPFS'),
    );

    if (_apiKey != null) request.headers['pinata_api_key'] = _apiKey;
    if (_apiSecret != null) request.headers['pinata_secret_api_key'] = _apiSecret;

    request.files.add(http.MultipartFile.fromBytes(
      'file',
      imageBytes,
      filename: filename,
    ));

    final response = await request.send();
    final body = await response.stream.bytesToString();

    if (response.statusCode == 200) {
      final data = jsonDecode(body);
      return 'ipfs://${data['IpfsHash']}';
    } else {
      throw Exception('Failed to upload image: $body');
    }
  }

  /// Upload a JSON object to IPFS
  Future<String> uploadJson(Map<String, dynamic> json, String name) async {
    final response = await http.post(
      Uri.parse(_uploadEndpoint),
      headers: {
        'Content-Type': 'application/json',
        if (_apiKey != null) 'pinata_api_key': _apiKey,
        if (_apiSecret != null) 'pinata_secret_api_key': _apiSecret,
      },
      body: jsonEncode({
        'pinataContent': json,
        'pinataMetadata': {
          'name': name,
        },
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return 'ipfs://${data['IpfsHash']}';
    } else {
      throw Exception('Failed to upload to IPFS: ${response.body}');
    }
  }
}

/// Vehicle metadata structure following NFT metadata standards
class VehicleMetadata {
  final String name;
  final String description;
  final String? image;
  final String? vin;
  final String? make;
  final String? model;
  final int? year;
  final String? color;
  final String? plateNumber;
  final String? engineType;
  final String? transmission;
  final String? fuelType;
  final int? currentMileage;
  final String? lastServiceDate;
  final String? sentinelDeviceId;
  final Map<String, dynamic>? attributes;

  VehicleMetadata({
    required this.name,
    this.description = '',
    this.image,
    this.vin,
    this.make,
    this.model,
    this.year,
    this.color,
    this.plateNumber,
    this.engineType,
    this.transmission,
    this.fuelType,
    this.currentMileage,
    this.lastServiceDate,
    this.sentinelDeviceId,
    this.attributes,
  });

  factory VehicleMetadata.fromJson(Map<String, dynamic> json) {
    return VehicleMetadata(
      name: json['name'] ?? 'Unknown Vehicle',
      description: json['description'] ?? '',
      image: json['image'],
      vin: json['vin'],
      make: json['make'],
      model: json['model'],
      year: json['year'],
      color: json['color'],
      plateNumber: json['plate_number'],
      engineType: json['engine_type'],
      transmission: json['transmission'],
      fuelType: json['fuel_type'],
      currentMileage: json['current_mileage'],
      lastServiceDate: json['last_service_date'],
      sentinelDeviceId: json['sentinel_device_id'],
      attributes: json['attributes'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      if (image != null) 'image': image,
      if (vin != null) 'vin': vin,
      if (make != null) 'make': make,
      if (model != null) 'model': model,
      if (year != null) 'year': year,
      if (color != null) 'color': color,
      if (plateNumber != null) 'plate_number': plateNumber,
      if (engineType != null) 'engine_type': engineType,
      if (transmission != null) 'transmission': transmission,
      if (fuelType != null) 'fuel_type': fuelType,
      if (currentMileage != null) 'current_mileage': currentMileage,
      if (lastServiceDate != null) 'last_service_date': lastServiceDate,
      if (sentinelDeviceId != null) 'sentinel_device_id': sentinelDeviceId,
      if (attributes != null) 'attributes': attributes,
    };
  }
}