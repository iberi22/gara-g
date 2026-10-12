import 'package:flutter/material.dart';

class DepinNodeTile extends StatelessWidget {
  final Map<String, dynamic> node;
  final VoidCallback onTap;

  const DepinNodeTile({
    Key? key,
    required this.node,
    required this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final String id = node['id'] ?? 'Unknown';
    final String status = node['status'] ?? 'offline';
    final String type = node['type'] ?? 'sentinel';

    Color statusColor;
    switch (status) {
      case 'online':
        statusColor = Colors.green;
        break;
      case 'relay':
        statusColor = Colors.blue;
        break;
      default:
        statusColor = Colors.red;
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
          child: Icon(Icons.developer_board, color: Theme.of(context).primaryColor),
        ),
        title: Text(
          'Node ${id.substring(0, 8)}...',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(type.toUpperCase()),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: statusColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              status.toUpperCase(),
              style: TextStyle(
                color: statusColor,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}
