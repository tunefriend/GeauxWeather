# Deploy GeauxWeather website (Cloudflare)

Same pattern as **tunefriend.org**: Cloudflare Worker + static assets + custom domain.

## Live URLs

**Primary:** **https://geauxweather.com**  
**Also:** https://www.geauxweather.com  
**Also:** `https://geauxweather.<your-subdomain>.workers.dev` after first deploy

## One-time: domain on the same Cloudflare account

1. Domain **geauxweather.com** must be active in the Cloudflare account you use with Wrangler.
2. Nameservers should already point at Cloudflare (you bought it there).

## Deploy

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
cd /home/james/puresky-build   # or your GeauxWeather clone

# If wrangler whoami fails:
#   npx wrangler login

npx wrangler deploy
```

Wrangler will attach `geauxweather.com` and `www.geauxweather.com` as custom domains
and create the DNS records automatically when `custom_domain = true`.

## After code changes

Edit files under `public/`, then:

```bash
npx wrangler deploy
```

## App / F-Droid

- Website field for listings: `https://geauxweather.com`
- Privacy policy: `https://geauxweather.com/privacy.html`
