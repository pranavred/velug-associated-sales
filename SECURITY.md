# Security

This is a prototype. The local dashboard is for localhost use. The cloud implementation is designed for one private demo with a shared password; it does not provide company-level data isolation or individual accountability.

Report suspected vulnerabilities privately to pranav@velug.ai. Do not include credentials or private customer data in a public issue.

Keep `.env`, `.dev.vars`, databases, snapshots, and deployed resource configuration out of version control. Keep `PRIVATE_SITE` set to `true` in the current cloud implementation. Never expose this configuration to multiple companies using shared inventory or research storage.
