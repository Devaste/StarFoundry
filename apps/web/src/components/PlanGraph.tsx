import '@xyflow/react/dist/style.css';
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Position, ReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import { planGraph, type Plan } from '@starfoundry/solver';
import ELK, { type ElkNode } from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../data';
import { formatEu, formatNumber, tierName } from '../format';
import type { Target } from '../plan';
import { usePlanActions } from '../planActions';
import { formatRate, useUnit } from '../units';

const RECIPE = { width: 240, height: 72 };
const ITEM = { width: 210, height: 46 };

let elk: InstanceType<typeof ELK> | undefined;
/** ELK runs in its own worker so a big layout never blocks the page. */
const getElk = () => (elk ??= new ELK({ workerFactory: () => new Worker(elkWorkerUrl) }));

type RecipeData = { title: string; tier: string; machines: string; eut: string; detail: string; configured: boolean; approximate: boolean };
type ItemData = { name: string; rate: string; kind: 'raw' | 'leaf' | 'source' | 'producible' | 'target' | 'byproduct' | 'hub'; label: string; fluid: boolean };
type FlowData = { points: { x: number; y: number }[]; label: string; labelAt?: { x: number; y: number }; loop: boolean; fluid: boolean };

function RecipeNode({ data }: NodeProps<Node<RecipeData>>) {
  return (
    <div className={`graph-node recipe${data.configured ? ' configured' : ''}`} title={data.title}>
      <Handle type="target" position={Position.Top} />
      <div className="graph-title"><strong>{data.title}</strong> <span className="tier">{data.tier}</span>{data.approximate && ' ≈'}</div>
      <div>{data.machines} <span className="muted">· {data.eut}</span></div>
      {data.detail && <div className="muted graph-detail">{data.detail}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ItemNode({ data }: NodeProps<Node<ItemData>>) {
  return (
    <div className={`graph-node item ${data.kind}${data.fluid ? ' fluid' : ''}`} title={data.name}>
      <Handle type="target" position={Position.Top} />
      <div className="graph-title"><span className={`badge ${data.kind}`}>{data.label}</span> <strong>{data.name}</strong></div>
      <div className="amount">{data.rate}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

/** Edge drawn along ELK's orthogonal route, with the flow as its label. */
function FlowEdge({ data, markerEnd }: EdgeProps<Edge<FlowData>>) {
  if (!data) return null;
  const [first, ...rest] = data.points;
  const path = first ? `M${first.x},${first.y}` + rest.map((p) => `L${p.x},${p.y}`).join('') : '';
  return (
    <>
      <BaseEdge path={path} {...(markerEnd ? { markerEnd } : {})} className={`flow${data.loop ? ' loop' : ''}${data.fluid ? ' fluid' : ''}`} />
      {data.labelAt && (
        <EdgeLabelRenderer>
          <div
            className={`flow-label${data.loop ? ' loop' : ''}${data.fluid ? ' fluid' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${data.labelAt.x}px, ${data.labelAt.y}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Middle of the route's longest segment, where a label has the most room. */
function longestSegmentMiddle(points: { x: number; y: number }[]) {
  let best: { x: number; y: number } | undefined;
  let length = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const l = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (l > length) {
      length = l;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}

const nodeTypes = { recipe: RecipeNode, item: ItemNode };
const edgeTypes = { flow: FlowEdge };

/**
 * The plan as a node graph (SPEC §2.1): machines as nodes, item flows as edges, imports at the top and
 * targets and byproducts at the bottom; loops are highlighted. Click a machine to set it up, an input to pick its recipe.
 */
export function PlanGraph({ plan, targets, onSelect }: { plan: Plan; targets: Target[]; onSelect: (good: number) => void }) {
  const { t } = useTranslation();
  const { data } = useData();
  const unit = useUnit();
  const actions = usePlanActions();
  const [showByproducts, setShowByproducts] = useState(false);
  const graph = useMemo(() => {
    const full = planGraph(plan, Object.fromEntries(targets.map((x) => [x.good, x.rate])));
    if (showByproducts) return full;
    // byproducts stay listed beside the graph; as nodes they crowd it
    const hidden = new Set(full.nodes.filter((n) => n.kind === 'byproduct').map((n) => n.id));
    return { nodes: full.nodes.filter((n) => !hidden.has(n.id)), edges: full.edges.filter((e) => !hidden.has(e.to)) };
  }, [plan, targets, showByproducts]);
  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[]; version: number }>();
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    const started = performance.now();
    const labels = new Map(graph.edges.map((e) => [e.id, `${formatRate(e.rate, unit, data.isFluid(e.good))} ${data.goodName(e.good)}`]));
    const elkGraph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.unnecessaryBendpoints': 'true',
        'elk.layered.mergeEdges': 'false',
        'elk.layered.spacing.nodeNodeBetweenLayers': '70',
        'elk.spacing.nodeNode': '24',
        'elk.layered.spacing.edgeNodeBetweenLayers': '20',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children: graph.nodes.map((n) => ({ id: n.id, ...(n.kind === 'recipe' ? RECIPE : ITEM) })),
      // edge labels are drawn by the page, not laid out by ELK: label dummies make big plans several times slower
      edges: graph.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
    };
    getElk().layout(elkGraph).then((laid) => {
      if (cancelled) return;
      const position = new Map(laid.children?.map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
      const nodes: Node[] = graph.nodes.map((n) => {
        const base = { id: n.id, position: position.get(n.id) ?? { x: 0, y: 0 } };
        if (n.kind === 'recipe') {
          const node = plan.nodes[n.node]!;
          const c = node.config;
          const detail = [
            c.hatch && (c.hatch.count > 1 || c.hatch.amps !== 2) && `${c.hatch.count}× ${c.hatch.amps}A`,
            c.ocLevel > 0 && t('plan.oc', { n: c.ocLevel }),
            c.parallels > 1 && t('plan.parallel', { n: c.parallels }),
            c.coil,
          ].filter(Boolean).join(', ');
          const recipeData: RecipeData = {
            title: c.machine !== undefined ? data.machineName(c.machine) : data.recipeTypeName(node.recipe.type),
            tier: tierName(c.machineTier),
            machines: t('graph.machines', { n: formatNumber(Math.round(node.machines * 100) / 100), whole: Math.ceil(node.machines - 1e-6) }),
            eut: `${formatEu(node.eut)} EU/t`,
            detail,
            configured: actions.state.configs[node.recipe.id] !== undefined,
            approximate: c.approximate,
          };
          return { ...base, ...RECIPE, type: 'recipe', data: recipeData, style: RECIPE };
        }
        const kind = n.kind === 'import' ? n.importKind : n.kind;
        const itemData: ItemData = {
          name: data.goodName(n.good),
          rate: formatRate(n.rate, unit, data.isFluid(n.good)),
          kind,
          label: t(`graph.kind.${kind}`),
          fluid: data.isFluid(n.good),
        };
        return { ...base, ...ITEM, type: 'item', data: itemData, style: ITEM };
      });
      const routes = new Map(laid.edges?.map((e) => [e.id, e]));
      const edges: Edge[] = graph.edges.map((e) => {
        const route = routes.get(e.id);
        const section = route?.sections?.[0];
        const points = section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : [];
        const labelAt = longestSegmentMiddle(points);
        const flow: FlowData = { points, label: labels.get(e.id)!, loop: e.loop, fluid: data.isFluid(e.good), ...(labelAt ? { labelAt } : {}) };
        return { id: e.id, source: e.from, target: e.to, type: 'flow', data: flow, markerEnd: { type: MarkerType.ArrowClosed } };
      });
      setLayout((prev) => ({ nodes, edges, version: (prev?.version ?? 0) + 1 }));
      setPending(false);
      if (import.meta.env.DEV) console.debug(`graph layout ${Math.round(performance.now() - started)} ms`);
    }).catch((error: unknown) => console.error('graph layout failed', error));
    return () => {
      cancelled = true;
    };
  }, [graph, plan, unit, data, t, actions.state.configs]);

  if (!layout) return <p className="muted">{t('graph.layout')}</p>;
  return (
    <div className={pending ? 'graph pending' : 'graph'}>
      {pending && <div className="graph-pending">{t('graph.layout')}</div>}
      <ReactFlow
        key={layout.version /* a new layout fits the view again */}
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="system"
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.05}
        fitView
        fitViewOptions={{ padding: 0.04, minZoom: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          const n = graph.nodes.find((x) => x.id === node.id);
          if (!n) return;
          if (n.kind === 'recipe') actions.openConfig(plan.nodes[n.node]!.recipe.id);
          else if ((n.kind === 'import' || n.kind === 'hub') && data.producers[n.good]!.length > 0) actions.openPicker(n.good);
          else onSelect(n.good);
        }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'recipe' ? '#3b82f6' : '#94a3b8')} />
      </ReactFlow>
      <div className="graph-footer">
        <label><input type="checkbox" checked={showByproducts} onChange={(e) => setShowByproducts(e.target.checked)} /> {t('graph.byproducts')}</label>
        <span className="muted">{t('graph.help')}</span>
      </div>
    </div>
  );
}
