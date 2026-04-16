# Tunnel Setup

Access Pocket remotely via Cloudflare tunnel at `bolt.clvg.uk`.

## Quick Setup

```bash
cloudflared tunnel --url http://localhost:8080
```

## Permanent Setup

1. Create tunnel:
   ```bash
   cloudflared tunnel create pocket
   ```

2. Add DNS record in Cloudflare dashboard:
   - Type: CNAME
   - Name: bolt
   - Target: `<tunnel-id>.cfargotunnel.com`

3. Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <id>
   credentials-file: /root/.cloudflared/<id>.json
   ingress:
     - hostname: bolt.clvg.uk
       service: http://localhost:8080
     - service: http_status:404
   ```

4. Run:
   ```bash
   cloudflared tunnel run pocket
   ```
