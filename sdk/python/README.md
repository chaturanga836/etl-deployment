# elt-sdk

Python HTTP client for the ELT Engine API.

```bash
pip install .
```

```python
from elt_sdk import EltClient

client = EltClient("https://api.example.com", get_access_token=lambda: "...")
projects = client.list_projects()
```
