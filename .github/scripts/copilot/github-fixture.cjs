// Simulate only source metadata. Copilot inference runs in a separate SDK child
// with a filtered environment and never loads this hook.
const json = body => globalThis.Response.json(body);
globalThis.fetch = async (input, options = {}) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  if (url !== 'https://api.github.com/graphql')
    throw new Error('Unexpected source metadata request');
  const query = JSON.parse(options.body).query;
  const repository = {};
  for (const match of query.matchAll(/C([a-f0-9]{40}):\s*object/g))
    repository[`C${match[1]}`] = {
      author: { user: { login: 'sample-author' } },
      associatedPullRequests: { nodes: [] },
    };
  return json({ data: { repository } });
};
