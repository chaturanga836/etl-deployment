# @elt/sdk

TypeScript/JavaScript HTTP client for the ELT Engine API.

```bash
npm install
npm run build
```

```typescript
import { EltClient } from '@elt/sdk';

const client = new EltClient({
  baseUrl: process.env.ELT_API_URL!,
  getAccessToken: async () => token,
});
```
