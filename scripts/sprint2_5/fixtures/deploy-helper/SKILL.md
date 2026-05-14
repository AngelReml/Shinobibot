---
name: deploy-helper
description: Asiste el despliegue a producción con checklist y rollback plan.
license: Apache-2.0
---

# Deploy Helper

Pre-flight checklist:
1. Tests passing.
2. Migration plan reviewed.
3. Rollback procedure documented.
4. Notifications wired (slack, email).

Post-deploy:
1. Smoke tests.
2. Error rates dashboard within 5min.
3. Auto-rollback if error rate > 5x baseline.
