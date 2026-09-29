import { Graphviz } from '@hpcc-js/wasm/graphviz';

let engine;
const quote = value => JSON.stringify(String(value));

export async function renderGraph(data, local = false) {
  engine ||= Graphviz.load();
  const graphviz = await engine;
  const ids = new Map(data.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = [
    'strict graph wiki {',
    'graph [bgcolor="transparent", pad="0.35", overlap="false", outputorder="edgesfirst", start="42", forcelabels="true"];',
    `node [shape="circle", fixedsize="true", width="0.13", height="0.13", label="", fontname="Helvetica Neue", fontsize="${local ? 9 : 10}", style="filled", penwidth="1"];`,
    'edge [color="#c7c5be", penwidth="0.9"];'
  ];
  for (const node of data.nodes) {
    const fill = node.current ? '#795842' : node.exists ? '#555b56' : '#c9c7c0';
    const label = node.current ? '#795842' : node.exists ? '#50544f' : '#969790';
    lines.push(`${quote(ids.get(node.id))} [id=${quote(`graph-${ids.get(node.id)}`)}, xlabel=${quote(node.title)}, fillcolor=${quote(fill)}, color=${quote(fill)}, fontcolor=${quote(label)}];`);
  }
  const seen = new Set();
  const renderedEdges = [];
  for (const edge of data.edges) {
    const pair = [ids.get(edge.source), ids.get(edge.target)].sort();
    const signature = pair.join(':');
    if (!seen.has(signature) && pair[0] && pair[1]) {
      seen.add(signature);
      const id = `edge-${pair[0]}-${pair[1]}`;
      lines.push(`${quote(pair[0])} -- ${quote(pair[1])} [id=${quote(id)}];`);
      renderedEdges.push({ id, source: `graph-${pair[0]}`, target: `graph-${pair[1]}` });
    }
  }
  lines.push('}');
  const svg = graphviz.layout(lines.join('\n'), 'svg', local ? 'neato' : data.nodes.length > 25 ? 'sfdp' : 'neato');
  return { svg, nodes: data.nodes.map(node => ({ id: `graph-${ids.get(node.id)}`, title: node.title, exists: node.exists })), edges: renderedEdges, count: data.nodes.filter(node => node.exists).length };
}
