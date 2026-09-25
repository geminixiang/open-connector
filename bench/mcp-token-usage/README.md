# search_actions output size

Compares `search_actions` output between `main` and this branch, and shows why it is large on `main`: every result repeats the full default connection profile, including its granted scopes.

It runs the MCP server in process against the generated catalog. The OAuth connections for Google Docs, Google Drive, and Sentry are fixtures that hold each provider's default scopes, so no network, credentials, or model are needed.

## Run

From an OpenConnector checkout with dependencies installed:

```sh
git fetch https://github.com/geminixiang/open-connector bench/mcp-token-usage
git switch --detach FETCH_HEAD
node bench/mcp-token-usage/compare.ts
```

The base is the merge-base with `origin/main`. Pass another ref if your upstream remote has a different name, for example `node bench/mcp-token-usage/compare.ts upstream/main`.

## Output

Sizes are characters of the compact `structuredContent`. Each column separates one change: the capability summary alone (`limit 20`) and together with the new default limit of 10.

```text
                                                                     base, default limit     head, limit 20   head, default limit
search_actions service="googledocs" query="create document"                  29,786 (20)   15,679 (20) -47%       7,733 (10) -74%
search_actions service="sentry" query="list organization issues"             26,606 (17)   20,227 (17) -24%      11,731 (10) -56%
search_actions service="googledrive" query="share file permission"           33,165 (20)   21,981 (20) -34%      12,233 (10) -63%
search_actions query="list organization issues"                              26,381 (20)   22,581 (20) -14%      14,049 (10) -47%
search_actions service="npm" query="package versions"                          6,653 (7)     4,490 (7) -33%        4,490 (7) -33%
```

It then prints the capability of the first Google Docs result on both revisions and checks that `get_action_guide` still returns the required and granted scopes.
