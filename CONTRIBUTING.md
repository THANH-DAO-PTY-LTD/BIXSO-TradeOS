# Contributing

Use a GitHub issue for workflow feedback or a bug. Include a fictional example, the commands you ran, the result you expected, and what happened. For a change to a flow, describe the decision being made, who makes it, and what must be true before it is allowed.

1. Clone the repo and create a branch with `git switch -c fix/short-description`.
2. Run `npm test` and `npm run demo`.
3. Add a test that captures the behaviour, make the smallest change, and run `npm test` again.
4. Open a PR with the linked issue, a short description and your test result. The maintainer checks the change and CI before merging.

Changes that weaken maker-checker, lineage, organisation isolation or idempotency need an issue first.

Submit only material you have the right to contribute. Contributions to this repository are provided under its [MIT license](LICENSE).

## Sign off your commits

Every commit in a pull request must be signed off. Use `git commit -s`, which adds a line like `Signed-off-by: Your Name <you@example.com>`. By signing off, you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org): you wrote the change, or otherwise have the right to submit it under this project's license. A check on each pull request looks for the sign-off.

Please also follow the [code of conduct](CODE_OF_CONDUCT.md).
