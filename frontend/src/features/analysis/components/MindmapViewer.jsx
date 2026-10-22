import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, ZoomIn, ZoomOut, Maximize2, X, FileText } from 'lucide-react';
import jsPDF from 'jspdf';

const MindmapViewer = ({ mindmapData, apiBaseUrl, getAuthToken }) => {
  const svgRef = useRef(null);
  const fullscreenSvgRef = useRef(null);
  const containerRef = useRef(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [error, setError] = useState(null);
  const [mermaidSyntax, setMermaidSyntax] = useState('');
  const [parsedNodes, setParsedNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [bounds, setBounds] = useState({ minX: 0, minY: 0, maxX: 2000, maxY: 1500 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1.2 });
  const [fullscreenTransform, setFullscreenTransform] = useState({ x: 0, y: 0, scale: 1.2 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [collapsedNodes, setCollapsedNodes] = useState(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [newlyExpandedNodes, setNewlyExpandedNodes] = useState(new Set());
  const [newlyVisibleConnections, setNewlyVisibleConnections] = useState(new Set());

  useEffect(() => {
    if (!mindmapData) {
      setMermaidSyntax('');
      setParsedNodes([]);
      setConnections([]);
      setCollapsedNodes(new Set());
      return;
    }

    console.log('MindmapViewer received data:', mindmapData);

    try {
      if (mindmapData.data && mindmapData.data.id && mindmapData.data.label !== undefined) {
        console.log('Using NotebookLM format');
        const { nodes, connections: conns, bounds: bds, allNodeIdsWithChildren } = parseNotebookLMMindmap(mindmapData.data);
        console.log('Parsed NotebookLM nodes:', nodes.length, 'connections:', conns.length);
        if (nodes.length > 0) {
          setParsedNodes(nodes);
          setConnections(conns);
          setBounds(bds);
          setCollapsedNodes(allNodeIdsWithChildren || new Set());
          setMermaidSyntax('');
          return;
        }
      }

      let hierarchicalData = null;
      if (mindmapData.mindmap_data) {
        hierarchicalData = mindmapData.mindmap_data;
      } else if (mindmapData.mindmap_json) {
        try {
          hierarchicalData = typeof mindmapData.mindmap_json === 'string'
            ? JSON.parse(mindmapData.mindmap_json)
            : mindmapData.mindmap_json;
        } catch (e) {
          console.error('Error parsing mindmap_json:', e);
        }
      }

      if (hierarchicalData) {
        console.log('Using hierarchical format');
        const { nodes, connections: conns, bounds: bds } = parseHierarchicalMindmap(hierarchicalData);
        console.log('Parsed hierarchical nodes:', nodes.length, 'connections:', conns.length);
        if (nodes.length > 0) {
          setParsedNodes(nodes);
          setConnections(conns);
          setBounds(bds);
          setMermaidSyntax('');
          return;
        }
      }

      let syntax = '';

      if (mindmapData.mermaid_syntax) {
        syntax = mindmapData.mermaid_syntax;
      } else if (mindmapData.flowchart_description) {
        const description = mindmapData.flowchart_description;
        const mermaidMatch = description.match(/```mermaid\s*([\s\S]*?)```/);
        if (mermaidMatch) {
          syntax = mermaidMatch[1].trim();
        } else {
          syntax = description;
        }
      } else if (mindmapData.flowchart) {
        syntax = mindmapData.flowchart;
      } else if (mindmapData.data) {
        if (mindmapData.data.title || (mindmapData.data.children && !mindmapData.data.id)) {
          console.log('Found hierarchical data in data field');
          const { nodes, connections: conns, bounds: bds } = parseHierarchicalMindmap(mindmapData.data);
          if (nodes.length > 0) {
            setParsedNodes(nodes);
            setConnections(conns);
            setBounds(bds);
            setMermaidSyntax('');
            return;
          }
        }
        syntax = typeof mindmapData.data === 'string' ? mindmapData.data : JSON.stringify(mindmapData.data);
      } else if (typeof mindmapData === 'string') {
        syntax = mindmapData;
      }


      console.log('Extracted mermaid syntax:', syntax);
     
      if (!syntax || syntax.length === 0) {
        console.error('No syntax found in response');
        setParsedNodes([]);
        setConnections([]);
        return;
      }

      setMermaidSyntax(syntax);
      const { nodes, connections: conns, bounds: bds } = parseMermaidToMindmap(syntax);
      console.log('Parsed mermaid nodes:', nodes.length, 'connections:', conns.length);
     
      if (nodes.length === 0) {
        console.warn('No nodes parsed from mermaid syntax. Syntax:', syntax.substring(0, 200));
      }
     
      setParsedNodes(nodes);
      setConnections(conns);
      setBounds(bds);
    } catch (error) {
      console.error('Error parsing mindmap data:', error);
      setParsedNodes([]);
      setConnections([]);
    }
  }, [mindmapData]);

  const parseNotebookLMMindmap = (rootNodeData) => {
    if (!rootNodeData) {
      console.warn('parseNotebookLMMindmap: No root node data provided');
      return { nodes: [], connections: [], bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 1500 } };
    }

    console.log('Parsing NotebookLM mindmap data:', rootNodeData);

    const nodes = [];
    const connections = [];
    const nodeMap = new Map();
    const allNodeIdsWithChildren = new Set();

    const colorPalette = [
      { bg: '#E6E0FF', border: '#A79CCF', text: '#0F172A' },
      { bg: '#D8F1FF', border: '#7BBBD8', text: '#0F172A' },
      { bg: '#DFF8E4', border: '#94C9A9', text: '#0F172A' },
      { bg: '#E6E0FF', border: '#A79CCF', text: '#0F172A' },
      { bg: '#D8F1FF', border: '#7BBBD8', text: '#0F172A' },
      { bg: '#DFF8E4', border: '#94C9A9', text: '#0F172A' },
    ];

    const processNode = (nodeData, parentId = null, level = 0) => {
      if (!nodeData || !nodeData.id) {
        console.warn('processNode: Invalid node data', nodeData);
        return null;
      }

      const nodeId = nodeData.id;
      const nodeLabel = (nodeData.label || '').trim();
     
      if (!nodeLabel || nodeLabel.length === 0) {
        console.warn('processNode: Node has no label', nodeId);
        return null;
      }

      const colorScheme = colorPalette[level % colorPalette.length];

      const node = {
        id: nodeId,
        label: nodeLabel,
        isMain: level === 0,
        children: [],
        level: level,
        color: colorScheme.bg,
        borderColor: colorScheme.border,
        textColor: colorScheme.text,
      };

      nodeMap.set(nodeId, node);
      nodes.push(node);

      if (parentId) {
        connections.push({ from: parentId, to: nodeId });
        if (nodeMap.has(parentId)) {
          nodeMap.get(parentId).children.push(nodeId);
        }
      }

      if (nodeData.children && Array.isArray(nodeData.children) && nodeData.children.length > 0) {
        allNodeIdsWithChildren.add(nodeId);
       
        nodeData.children.forEach((child) => {
          processNode(child, nodeId, level + 1);
        });
      }

      return nodeId;
    };

    const rootProcessed = processNode(rootNodeData, null, 0);
    if (!rootProcessed) {
      console.error('Failed to process root node');
      return { nodes: [], connections: [], bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 1500 }, allNodeIdsWithChildren: new Set() };
    }
   
    if (rootProcessed) {
      allNodeIdsWithChildren.delete(rootProcessed);
    }
   
    console.log('Processed nodes:', nodes.length, 'connections:', connections.length);

    const positionedNodes = [];
    const padding = 50;
    const horizontalSpacing = 140;
    const verticalSpacing = 16;
    const minNodeHeight = 48;
    const minNodeWidth = 120;
    const maxNodeWidth = 240;
    const minChildNodeWidth = 180;
    const maxChildNodeWidth = 340;

    const calculateFontSize = (textLength, isMain) => {
      if (isMain) {
        return Math.max(14, Math.min(18, 20 - textLength * 0.15));
      } else {
        return Math.max(12, Math.min(16, 18 - textLength * 0.12));
      }
    };

    const calculateSubtreeHeight = (nodeId, nodeMap) => {
      const node = Array.from(nodeMap.values()).find(n => n.id === nodeId);
      if (!node || !node.children || node.children.length === 0) {
        return minNodeHeight;
      }
     
      const childrenHeight = node.children.reduce((sum, childId) => {
        return sum + calculateSubtreeHeight(childId, nodeMap) + verticalSpacing;
      }, 0) - verticalSpacing;
     
      return Math.max(minNodeHeight, childrenHeight);
    };

    const positionNode = (nodeId, x, y, nodeMap) => {
      const node = Array.from(nodeMap.values()).find(n => n.id === nodeId);
      if (!node) {
        console.error('positionNode: Node not found:', nodeId);
        return;
      }

      const fontSize = calculateFontSize(node.label.length, node.isMain);
      const lineHeight = fontSize * 1.4;
      const charWidth = fontSize * 0.6;
     
      const baseTextArea = node.isMain ? 220 : 320;
      const maxCharsPerLine = Math.floor(baseTextArea / charWidth);
      const words = node.label.split(' ');
      const lines = [];
      let currentLine = '';
     
      words.forEach((word) => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (testLine.length <= maxCharsPerLine) {
          currentLine = testLine;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      });
      if (currentLine) lines.push(currentLine);
     
      const actualLines = Math.max(1, lines.length);
      const textPadding = node.isMain ? 24 : 32;
      const effectiveMinWidth = node.isMain ? minNodeWidth : minChildNodeWidth;
      const effectiveMaxWidth = node.isMain ? maxNodeWidth : maxChildNodeWidth;
      const nodeWidth = Math.min(effectiveMaxWidth, Math.max(effectiveMinWidth, Math.max(...lines.map(l => l.length)) * charWidth + textPadding));
      const nodeHeight = Math.max(minNodeHeight, actualLines * lineHeight + textPadding);

      const positionedNode = {
        ...node,
        x,
        y: y - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
      };
     
      positionedNodes.push(positionedNode);
     
      console.log('Positioned node:', {
        id: nodeId,
        label: node.label,
        x,
        y: y - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
        childrenCount: node.children ? node.children.length : 0
      });

      if (node.children && node.children.length > 0) {
        const totalChildrenHeight = node.children.reduce((sum, childId) => {
          return sum + calculateSubtreeHeight(childId, nodeMap) + verticalSpacing;
        }, 0) - verticalSpacing;

        let currentY = y - totalChildrenHeight / 2;

        node.children.forEach((childId, index) => {
          const childHeight = calculateSubtreeHeight(childId, nodeMap);
          console.log('Positioning child:', { childId, index, currentY, childHeight });
          positionNode(childId, x + nodeWidth + horizontalSpacing, currentY + childHeight / 2, nodeMap);
          currentY += childHeight + verticalSpacing;
        });
      }
    };

    const rootNodeCalc = nodes.find(n => n.isMain);
    let totalTreeHeight = 0;
    if (rootNodeCalc) {
      totalTreeHeight = calculateSubtreeHeight(rootNodeCalc.id, nodeMap);
      console.log('Total tree height calculated:', totalTreeHeight);
    }
   
    const rootNode = nodes.find(n => n.isMain);
    if (rootNode) {
      const startX = padding + 50;
      const startY = Math.max(totalTreeHeight / 2 + padding * 2, 450);
      console.log('Starting position for root:', { startX, startY, rootId: rootNode.id });
      positionNode(rootNode.id, startX, startY, nodeMap);
    }
   
    console.log('Positioned nodes count:', positionedNodes.length);
   
    const invalidNodes = positionedNodes.filter(n =>
      typeof n.x !== 'number' || typeof n.y !== 'number' ||
      typeof n.width !== 'number' || typeof n.height !== 'number' ||
      isNaN(n.x) || isNaN(n.y) || isNaN(n.width) || isNaN(n.height)
    );
   
    if (invalidNodes.length > 0) {
      console.error('Found nodes with invalid positions:', invalidNodes);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positionedNodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
   
    console.log('Bounds calculated:', { minX, minY, maxX, maxY });

    return {
      nodes: positionedNodes,
      connections: connections,
      bounds: {
        minX: Math.max(0, minX - padding),
        minY: Math.max(0, minY - padding),
        maxX: maxX + padding * 3,
        maxY: maxY + padding * 3,
      },
      allNodeIdsWithChildren,
    };
  };

  const parseHierarchicalMindmap = (mindmapData) => {
    if (!mindmapData) return { nodes: [], connections: [], bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 1500 } };

    console.log('Parsing hierarchical mindmap data:', mindmapData);

    const nodes = [];
    const connections = [];
    const nodeMap = new Map();
    let nodeIdCounter = 0;

    const colorPalette = [
      { bg: '#E6E0FF', border: '#A79CCF', text: '#0F172A' },
      { bg: '#D8F1FF', border: '#7BBBD8', text: '#0F172A' },
      { bg: '#DFF8E4', border: '#94C9A9', text: '#0F172A' },
      { bg: '#E6E0FF', border: '#A79CCF', text: '#0F172A' },
      { bg: '#D8F1FF', border: '#7BBBD8', text: '#0F172A' },
      { bg: '#DFF8E4', border: '#94C9A9', text: '#0F172A' },
    ];

    const generateId = () => `node_${nodeIdCounter++}`;

    const processNode = (nodeData, parentId = null, level = 0) => {
      if (!nodeData) return null;

      const nodeId = generateId();
      const nodeText = (nodeData.text || nodeData.title || '').trim();
     
      if (!nodeText || nodeText.length === 0 || nodeText.length < 3) {
        return null;
      }

      const placeholderPatterns = /^(end|start|begin|finish|node|item|step|point)$/i;
      if (placeholderPatterns.test(nodeText)) {
        return null;
      }

      const colorScheme = colorPalette[level % colorPalette.length];

      const node = {
        id: nodeId,
        label: nodeText.trim(),
        isMain: level === 0,
        children: [],
        level: level,
        color: colorScheme.bg,
        textColor: colorScheme.text,
      };

      nodeMap.set(nodeId, node);
      nodes.push(node);

      if (parentId) {
        connections.push({ from: parentId, to: nodeId });
        nodeMap.get(parentId).children.push(nodeId);
      }

      if (nodeData.children && Array.isArray(nodeData.children)) {
        nodeData.children.forEach((child) => {
          processNode(child, nodeId, level + 1);
        });
      }

      return nodeId;
    };

    const rootId = processNode({ text: mindmapData.title || 'Central Theme' }, null, 0);

    if (mindmapData.children && Array.isArray(mindmapData.children)) {
      mindmapData.children.forEach((child) => {
        processNode(child, rootId, 1);
      });
    }

    const connectionSet = new Set();
    const nodeToParent = new Map();
    const finalConnections = [];
    connections.forEach(conn => {
      const key = `${conn.from}->${conn.to}`;
      if (!connectionSet.has(key) && !nodeToParent.has(conn.to)) {
        connectionSet.add(key);
        nodeToParent.set(conn.to, conn.from);
        finalConnections.push(conn);
      }
    });
   
    nodeMap.forEach((node) => {
      node.children = [];
    });
    finalConnections.forEach(conn => {
      if (nodeMap.has(conn.from)) {
        nodeMap.get(conn.from).children.push(conn.to);
      }
    });
   
    connections.length = 0;
    connections.push(...finalConnections);

    const positionedNodes = [];
    const padding = 60;
    const horizontalSpacing = 180;
    const verticalSpacing = 20;
    const minNodeHeight = 60;
    const minNodeWidth = 180;
    const maxNodeWidth = 280;
    const minChildNodeWidth = 250;
    const maxChildNodeWidth = 390;

    const calculateSubtreeHeight = (nodeId, nodeMap) => {
      const node = nodeMap.get(nodeId);
      if (!node || !node.children || node.children.length === 0) {
        return minNodeHeight;
      }
     
      const childrenHeight = node.children.reduce((sum, childId) => {
        return sum + calculateSubtreeHeight(childId, nodeMap) + verticalSpacing;
      }, 0) - verticalSpacing;
     
      return Math.max(minNodeHeight, childrenHeight);
    };

    const positionNode = (nodeId, x, y, nodeMap) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const estimatedCharsPerLine = node.isMain ? 25 : 35;
      const lines = Math.max(1, Math.ceil(node.label.length / estimatedCharsPerLine));
      const effectiveMinWidth = node.isMain ? minNodeWidth : minChildNodeWidth;
      const effectiveMaxWidth = node.isMain ? maxNodeWidth : maxChildNodeWidth;
      const textPadding = node.isMain ? 40 : 56;
      const nodeWidth = Math.min(effectiveMaxWidth, Math.max(effectiveMinWidth, node.label.length * 7 + textPadding));
      const nodeHeight = Math.max(minNodeHeight, lines * 20 + 28);

      positionedNodes.push({
        ...node,
        x,
        y: y - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
      });

      if (node.children && node.children.length > 0) {
        const totalChildrenHeight = node.children.reduce((sum, childId) => {
          return sum + calculateSubtreeHeight(childId, nodeMap) + verticalSpacing;
        }, 0) - verticalSpacing;

        let currentY = y - totalChildrenHeight / 2;

        node.children.forEach((childId) => {
          const childHeight = calculateSubtreeHeight(childId, nodeMap);
          positionNode(childId, x + nodeWidth + horizontalSpacing, currentY + childHeight / 2, nodeMap);
          currentY += childHeight + verticalSpacing;
        });
      }
    };

    const rootNode = nodes.find(n => n.isMain);
    if (rootNode) {
      const totalTreeHeight = calculateSubtreeHeight(rootNode.id, nodeMap);
      const startX = padding + 50;
      const startY = Math.max(totalTreeHeight / 2 + padding * 2, 450);
      positionNode(rootNode.id, startX, startY, nodeMap);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positionedNodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });

    return {
      nodes: positionedNodes,
      connections: connections,
      bounds: {
        minX: Math.max(0, minX - padding),
        minY: Math.max(0, minY - padding),
        maxX: maxX + padding * 3,
        maxY: maxY + padding * 3,
      },
    };
  };

  const parseMermaidToMindmap = (syntax) => {
    if (!syntax) return { nodes: [], connections: [], bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 1500 } };

    const lines = syntax.split('\n').map(line => line.trim()).filter(line => line);
    const nodeMap = new Map();
    const conns = [];
    const nodeHierarchy = new Map();

    const colorPalette = [
      { bg: '#E6E0FF', border: '#A79CCF', text: '#0F172A' },
      { bg: '#D8F1FF', border: '#7BBBD8', text: '#0F172A' },
      { bg: '#DFF8E4', border: '#94C9A9', text: '#0F172A' },
      { bg: '#E6E0FF', border: '#A79CCF', text: '#0F172A' },
      { bg: '#D8F1FF', border: '#7BBBD8', text: '#0F172A' },
      { bg: '#DFF8E4', border: '#94C9A9', text: '#0F172A' },
    ];

    for (const line of lines) {
      if (line.startsWith('graph') || line.startsWith('flowchart') || line.startsWith('mindmap')) {
        continue;
      }

      const connectionMatch = line.match(/(\w+)(?:\[([^\]]+)\]|\(([^\)]+)\))?\s*(?:-->|---|--)\s*(\w+)(?:\[([^\]]+)\]|\(([^\)]+)\))?/);
      if (connectionMatch) {
        const [, fromId, fromLabelBracket, fromLabelParen, toId, toLabelBracket, toLabelParen] = connectionMatch;
        const fromLabel = (fromLabelBracket || fromLabelParen || '').trim();
        const toLabel = (toLabelBracket || toLabelParen || '').trim();
       
        if (!nodeMap.has(fromId) && fromLabel) {
          nodeMap.set(fromId, {
            id: fromId,
            label: fromLabel,
            isMain: false,
            children: [],
            level: 0,
          });
        } else if (fromLabel && nodeMap.has(fromId)) {
          const existingNode = nodeMap.get(fromId);
          if (!existingNode.label || existingNode.label === fromId || existingNode.label.trim() === '') {
            existingNode.label = fromLabel;
          }
        }

        if (!nodeMap.has(toId) && toLabel) {
          nodeMap.set(toId, {
            id: toId,
            label: toLabel,
            isMain: false,
            children: [],
            level: 0,
          });
        } else if (toLabel && nodeMap.has(toId)) {
          const existingNode = nodeMap.get(toId);
          if (!existingNode.label || existingNode.label === toId || existingNode.label.trim() === '') {
            existingNode.label = toLabel;
          }
        }

        if (nodeMap.has(fromId) && nodeMap.has(toId)) {
          if (!nodeHierarchy.has(toId)) {
            nodeHierarchy.set(toId, fromId);
          }
          if (nodeMap.get(fromId)) {
            nodeMap.get(fromId).children.push(toId);
          }
          conns.push({ from: fromId, to: toId });
        }
        continue;
      }

      const nodeMatchBracket = line.match(/(\w+)\[([^\]]+)\]/);
      const nodeMatchParen = line.match(/(\w+)\(([^\)]+)\)/);
      const nodeMatch = nodeMatchBracket || nodeMatchParen;
      if (nodeMatch) {
        const [, id, label] = nodeMatch;
        if (label && label.trim()) {
          if (!nodeMap.has(id)) {
            nodeMap.set(id, {
              id,
              label: label.trim(),
              isMain: false,
              children: [],
              level: 0,
            });
          } else {
            nodeMap.get(id).label = label.trim();
          }
        }
      }
    }

    const allNodeMatches = syntax.matchAll(/(\w+)(?:\[([^\]]+)\]|\(([^\)]+)\))/g);
    for (const match of allNodeMatches) {
      const [, id, labelBracket, labelParen] = match;
      const label = (labelBracket || labelParen || '').trim();
      if (label && label.length >= 2 && (label !== id || label.length > 3) && !/^(end|start|begin|finish)$/i.test(label)) {
        if (!nodeMap.has(id)) {
          nodeMap.set(id, {
            id,
            label,
            isMain: false,
            children: [],
            level: 0,
          });
        } else if (!nodeMap.get(id).label || nodeMap.get(id).label === id || nodeMap.get(id).label.trim().length < 2) {
          nodeMap.get(id).label = label;
        }
      }
    }

    const validNodes = Array.from(nodeMap.entries()).filter(([id, node]) => {
      const label = node.label ? node.label.trim() : '';
      if (label.length === 0) return false;
      if (label === id && id.length <= 3) return false;
      if (label.length === 1 && label === id) return false;
      const placeholderPatterns = /^(end|start|begin|finish)$/i;
      if (placeholderPatterns.test(label) && label.length <= 5) return false;
      return true;
    });

    nodeMap.clear();
    validNodes.forEach(([id, node]) => {
      nodeMap.set(id, node);
    });

    const validConnections = conns.filter(conn =>
      nodeMap.has(conn.from) && nodeMap.has(conn.to)
    );
   
    const connectionSet = new Set();
    const uniqueConnections = [];
    validConnections.forEach(conn => {
      const key = `${conn.from}->${conn.to}`;
      if (!connectionSet.has(key)) {
        connectionSet.add(key);
        uniqueConnections.push(conn);
      }
    });
   
    const nodeToParent2 = new Map();
    const finalConnections = [];
    uniqueConnections.forEach(conn => {
      if (!nodeToParent2.has(conn.to)) {
        nodeToParent2.set(conn.to, conn.from);
        finalConnections.push(conn);
      }
    });
   
    nodeHierarchy.clear();
    nodeMap.forEach((node) => {
      node.children = [];
    });
    finalConnections.forEach(conn => {
      nodeHierarchy.set(conn.to, conn.from);
      if (nodeMap.has(conn.from)) {
        nodeMap.get(conn.from).children.push(conn.to);
      }
    });
   
    conns.length = 0;
    conns.push(...finalConnections);

    if (nodeMap.size === 0) {
      return { nodes: [], connections: [], bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 1500 } };
    }

    const allTargets = new Set(conns.map(c => c.to));
    let rootNodeId = Array.from(nodeMap.keys()).find(id => !allTargets.has(id));
   
    if (!rootNodeId) {
      rootNodeId = Array.from(nodeMap.keys())[0];
    }

    if (rootNodeId && nodeMap.has(rootNodeId)) {
      nodeMap.get(rootNodeId).isMain = true;
      nodeMap.get(rootNodeId).level = 0;
    }

    const calculateLevel = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);
     
      const parentId = nodeHierarchy.get(nodeId);
      if (parentId && nodeMap.has(parentId)) {
        const parentLevel = calculateLevel(parentId, visited);
        const level = parentLevel + 1;
        if (nodeMap.has(nodeId)) {
          nodeMap.get(nodeId).level = level;
          const colorScheme = colorPalette[level % colorPalette.length];
          nodeMap.get(nodeId).color = colorScheme.bg;
          nodeMap.get(nodeId).borderColor = colorScheme.border;
          nodeMap.get(nodeId).textColor = colorScheme.text;
        }
        return level;
      }
      return nodeMap.get(nodeId)?.level || 0;
    };

    nodeMap.forEach((node, id) => {
      if (!node.isMain) {
        calculateLevel(id);
      } else {
        node.color = colorPalette[0].bg;
        node.borderColor = colorPalette[0].border;
        node.textColor = colorPalette[0].text;
      }
    });

    const positionedNodes = [];
    const padding = 60;
    const horizontalSpacing = 180;
    const verticalSpacing = 20;
    const minNodeHeight = 60;
    const minNodeWidth = 180;
    const maxNodeWidth = 280;
    const minChildNodeWidth = 250;
    const maxChildNodeWidth = 390;

    const calculateSubtreeHeight = (nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node || !node.children || node.children.length === 0) {
        return minNodeHeight;
      }
     
      const childrenHeight = node.children.reduce((sum, childId) => {
        return sum + calculateSubtreeHeight(childId) + verticalSpacing;
      }, 0) - verticalSpacing;
     
      return Math.max(minNodeHeight, childrenHeight);
    };

    const positionNode = (nodeId, x, y) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      if (!node.label || !node.label.trim()) {
        node.label = nodeId;
      }
     
      const estimatedCharsPerLine = node.isMain ? 25 : 35;
      const lines = Math.max(1, Math.ceil(node.label.length / estimatedCharsPerLine));
      const effectiveMinWidth = node.isMain ? minNodeWidth : minChildNodeWidth;
      const effectiveMaxWidth = node.isMain ? maxNodeWidth : maxChildNodeWidth;
      const textPadding = node.isMain ? 40 : 56;
      const nodeWidth = Math.min(effectiveMaxWidth, Math.max(effectiveMinWidth, node.label.length * 7 + textPadding));
      const nodeHeight = Math.max(minNodeHeight, lines * 20 + 28);
     
      positionedNodes.push({
        ...node,
        x,
        y: y - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
      });

      if (node.children && node.children.length > 0) {
        const totalChildrenHeight = node.children.reduce((sum, childId) => {
          return sum + calculateSubtreeHeight(childId) + verticalSpacing;
        }, 0) - verticalSpacing;

        let currentY = y - totalChildrenHeight / 2;

        node.children.forEach((childId) => {
          const childHeight = calculateSubtreeHeight(childId);
          positionNode(childId, x + nodeWidth + horizontalSpacing, currentY + childHeight / 2);
          currentY += childHeight + verticalSpacing;
        });
      }
    };

    const rootNode = nodeMap.get(rootNodeId);
    if (rootNode) {
      const totalTreeHeight = calculateSubtreeHeight(rootNodeId);
      const startX = padding + 50;
      const startY = Math.max(totalTreeHeight / 2 + padding * 2, 450);
      positionNode(rootNodeId, startX, startY);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positionedNodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });

    return {
      nodes: positionedNodes,
      connections: conns,
      bounds: {
        minX: Math.max(0, minX - padding),
        minY: Math.max(0, minY - padding),
        maxX: maxX + padding * 3,
        maxY: maxY + padding * 3,
      },
    };
  };

  const handleNodeClick = async (nodeId) => {
    const node = parsedNodes.find(n => n.id === nodeId);
    if (!node || !node.children || node.children.length === 0) {
      return;
    }

    const isCollapsed = collapsedNodes.has(nodeId);
    const newCollapsedNodes = new Set(collapsedNodes);
    const newExpandedNodes = new Set();
    const newVisibleConnections = new Set();
   
    if (isCollapsed) {
      newCollapsedNodes.delete(nodeId);
     
      const collectChildren = (parentId) => {
        const parent = parsedNodes.find(n => n.id === parentId);
        if (!parent || !parent.children) return;
       
        parent.children.forEach(childId => {
          newExpandedNodes.add(childId);
          newVisibleConnections.add(`${parentId}->${childId}`);
         
          const child = parsedNodes.find(n => n.id === childId);
          if (child && !newCollapsedNodes.has(childId) && child.children) {
            collectChildren(childId);
          }
        });
      };
     
      collectChildren(nodeId);
    } else {
      newCollapsedNodes.add(nodeId);
    }
   
    setCollapsedNodes(newCollapsedNodes);
    setNewlyExpandedNodes(newExpandedNodes);
    setNewlyVisibleConnections(newVisibleConnections);
   
    setTimeout(() => {
      setNewlyExpandedNodes(new Set());
      setNewlyVisibleConnections(new Set());
    }, 600);

    if (apiBaseUrl && getAuthToken) {
      try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        await fetch(`${apiBaseUrl}/visual/mindmap/node/state`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            node_id: nodeId,
            is_collapsed: !isCollapsed,
          }),
        });
      } catch (error) {
        console.error('Error updating node state:', error);
      }
    }
  };

  const getVisibleNodes = () => {
    const visibleNodes = [];
    const visibleNodeIds = new Set();
   
    const addNodeAndChildren = (nodeId) => {
      const node = parsedNodes.find(n => n.id === nodeId);
      if (!node) return;
     
      visibleNodes.push(node);
      visibleNodeIds.add(nodeId);
     
      if (!collapsedNodes.has(nodeId) && node.children && node.children.length > 0) {
        node.children.forEach(childId => {
          addNodeAndChildren(childId);
        });
      }
    };
   
    const rootNodes = parsedNodes.filter(n => n.isMain || !connections.some(c => c.to === n.id));
    rootNodes.forEach(root => {
      addNodeAndChildren(root.id);
    });
   
    return { visibleNodes, visibleNodeIds };
  };

  const renderMindmap = (svgElement) => {
    if (!svgElement || !parsedNodes.length) {
      console.warn('renderMindmap: No SVG element or no parsed nodes');
      return;
    }

    const { visibleNodes, visibleNodeIds } = getVisibleNodes();
    console.log('Rendering mindmap:', {
      totalNodes: parsedNodes.length,
      visibleNodes: visibleNodes.length,
      visibleNodeIds: Array.from(visibleNodeIds),
      connections: connections.length
    });
   
    const viewBoxWidth = Math.max(1200, bounds.maxX - bounds.minX);
    const viewBoxHeight = Math.max(800, bounds.maxY - bounds.minY);
   
    console.log('ViewBox dimensions:', { viewBoxWidth, viewBoxHeight, bounds });
   
    svgElement.innerHTML = '';
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    svgElement.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${viewBoxWidth} ${viewBoxHeight}`);
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
   
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'shadow');
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');
   
    const feDropShadow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    feDropShadow.setAttribute('dx', '0');
    feDropShadow.setAttribute('dy', '1');
    feDropShadow.setAttribute('stdDeviation', '3');
    feDropShadow.setAttribute('flood-opacity', '0.08');
    filter.appendChild(feDropShadow);
    defs.appendChild(filter);
   
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 8 3, 0 6');
    polygon.setAttribute('fill', '#CCCCCC');
    polygon.setAttribute('opacity', '0.6');
    marker.appendChild(polygon);
    defs.appendChild(marker);
   
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      @keyframes nodeFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes nodeScaleIn {
        from {
          transform: scale(0.9);
        }
        to {
          transform: scale(1);
        }
      }
      @keyframes nodeSlideIn {
        from {
          transform: translate(-15px, 0) scale(0.9);
        }
        to {
          transform: translate(0, 0) scale(1);
        }
      }
      @keyframes pathDraw {
        from {
          stroke-dashoffset: 1000;
          opacity: 0;
        }
        to {
          stroke-dashoffset: 0;
          opacity: 0.6;
        }
      }
      .mindmap-node-animate {
        animation: nodeFadeIn 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards,
                   nodeScaleIn 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards,
                   nodeSlideIn 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
      }
      .mindmap-connection-animate {
        animation: pathDraw 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
      }
    `;
    defs.appendChild(style);
   
    svgElement.appendChild(defs);

    const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));

    connections.forEach((conn, connIndex) => {
      if (!visibleNodeIds.has(conn.from) || !visibleNodeIds.has(conn.to)) {
        return;
      }
     
      const fromNode = nodeMap.get(conn.from);
      const toNode = nodeMap.get(conn.to);
     
      if (!fromNode || !toNode) {
        console.warn('Skipping connection - node not found:', { from: conn.from, to: conn.to });
        return;
      }
     
      if (!fromNode.x || !fromNode.y || !fromNode.width || !fromNode.height ||
          !toNode.x || !toNode.y || !toNode.width || !toNode.height) {
        console.warn('Skipping connection - invalid node dimensions:', { fromNode, toNode });
        return;
      }
     
      const startX = fromNode.x + fromNode.width;
      const startY = fromNode.y + fromNode.height / 2;
      const endX = toNode.x;
      const endY = toNode.y + toNode.height / 2;
     
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
     
      const controlX1 = startX + (endX - startX) / 3;
      const controlY1 = startY;
      const controlX2 = startX + (endX - startX) * 2 / 3;
      const controlY2 = endY;
     
      const pathData = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#6B7280');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('opacity', '0.7');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('marker-end', 'url(#arrowhead)');
     
      const connKey = `${conn.from}->${conn.to}`;
      const shouldAnimate = newlyVisibleConnections.has(connKey);
     
      svgElement.appendChild(path);
     
      if (shouldAnimate) {
        requestAnimationFrame(() => {
          const pathLength = path.getTotalLength();
          if (pathLength > 0) {
            path.setAttribute('class', 'mindmap-connection-animate');
            path.setAttribute('stroke-dasharray', pathLength.toString());
            path.setAttribute('stroke-dashoffset', pathLength.toString());
            path.style.animationDelay = `${connIndex * 0.04}s`;
            path.style.opacity = '0';
          }
        });
      }
    });

    visibleNodes.forEach((node, nodeIndex) => {
      if (!node || !node.id || !node.label) {
        console.warn('Skipping invalid node:', node);
        return;
      }
     
      if (typeof node.x !== 'number' || typeof node.y !== 'number' ||
          typeof node.width !== 'number' || typeof node.height !== 'number') {
        console.warn('Skipping node with invalid position/dimensions:', node);
        return;
      }
     
      const hasChildren = node.children && node.children.length > 0;
      const isCollapsed = collapsedNodes.has(node.id);
      const isNewlyExpanded = newlyExpandedNodes.has(node.id);
     
      console.log('Rendering node:', {
        id: node.id,
        label: node.label,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        hasChildren,
        isCollapsed,
        isNewlyExpanded
      });
     
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'mindmap-node-group');
      g.setAttribute('data-node-id', node.id);
     
      if (isNewlyExpanded) {
        g.setAttribute('class', 'mindmap-node-group mindmap-node-animate');
        const parentConnection = connections.find(c => c.to === node.id);
        let animationDelay = 0;
        if (parentConnection) {
          const parentNode = nodeMap.get(parentConnection.from);
          if (parentNode && parentNode.children) {
            const siblingIndex = parentNode.children.indexOf(node.id);
            animationDelay = siblingIndex * 0.05;
          }
        }
        g.style.opacity = '0';
        g.style.transform = 'scale(0.9)';
        g.style.transformOrigin = 'center center';
        g.style.animationDelay = `${animationDelay}s`;
      }
     
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', node.x);
      rect.setAttribute('y', node.y);
      rect.setAttribute('width', node.width);
      rect.setAttribute('height', node.height);
      rect.setAttribute('rx', '12');
      rect.setAttribute('ry', '12');
      const backgroundColor = node.color || '#E6E0FF';
      const borderColor = node.borderColor || '#A79CCF';
      rect.setAttribute('fill', backgroundColor);
      rect.setAttribute('filter', 'url(#shadow)');
      rect.setAttribute('stroke', borderColor);
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('cursor', hasChildren ? 'pointer' : 'default');
      rect.setAttribute('class', 'mindmap-node');
     
      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        handleNodeClick(node.id);
      });
     
      g.appendChild(rect);

      const calculateFontSize = (textLength, isMain) => {
        if (isMain) {
          return Math.max(14, Math.min(18, 20 - textLength * 0.15));
        } else {
          return Math.max(12, Math.min(16, 18 - textLength * 0.12));
        }
      };
     
      const fontSize = calculateFontSize(node.label.length, node.isMain);
      const lineHeight = fontSize * 1.4;
      const charWidth = fontSize * 0.6;
     
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', node.x + node.width / 2);
      text.setAttribute('y', node.y + node.height / 2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
     
      const textColor = node.textColor || '#000000';
     
      text.setAttribute('fill', textColor);
      text.setAttribute('font-size', fontSize.toString());
      text.setAttribute('font-weight', node.isMain ? '600' : '500');
      text.setAttribute('font-family', '"Google Sans", "Product Sans", Inter, Roboto, Arial, sans-serif');
      text.setAttribute('text-rendering', 'optimizeLegibility');
      text.setAttribute('pointer-events', 'none');
     
      const words = node.label.split(' ');
      const lines = [];
      let currentLine = '';
      const textPadding = node.isMain ? 24 : 32;
      const maxCharsPerLine = Math.floor((node.width - textPadding) / charWidth);
     
      words.forEach((word) => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
       
        if (testLine.length <= maxCharsPerLine) {
          currentLine = testLine;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      });
      if (currentLine) lines.push(currentLine);

      const totalHeight = lines.length * lineHeight;
      const startY = node.y + (node.height - totalHeight) / 2 + lineHeight / 2;

      lines.forEach((line, index) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', node.x + node.width / 2);
        tspan.setAttribute('y', startY + (index * lineHeight));
        tspan.setAttribute('text-anchor', 'middle');
        tspan.setAttribute('dominant-baseline', 'middle');
        tspan.setAttribute('font-size', fontSize.toString());
        tspan.setAttribute('font-family', '"Google Sans", "Product Sans", Inter, Roboto, Arial, sans-serif');
        tspan.setAttribute('font-weight', node.isMain ? '600' : '500');
        tspan.setAttribute('fill', '#000000');
        tspan.setAttribute('text-rendering', 'optimizeLegibility');
        tspan.textContent = line;
        text.appendChild(tspan);
      });

      g.appendChild(text);

      if (hasChildren) {
        const indicatorSize = 24;
        const indicatorX = node.x + node.width - indicatorSize - 8;
        const indicatorY = node.y + node.height / 2 - indicatorSize / 2;
       
        const indicatorBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        indicatorBg.setAttribute('x', indicatorX);
        indicatorBg.setAttribute('y', indicatorY);
        indicatorBg.setAttribute('width', indicatorSize);
        indicatorBg.setAttribute('height', indicatorSize);
        indicatorBg.setAttribute('rx', '6');
        indicatorBg.setAttribute('fill', 'rgba(255, 255, 255, 0.95)');
        indicatorBg.setAttribute('stroke', borderColor);
        indicatorBg.setAttribute('stroke-width', '1.5');
        indicatorBg.setAttribute('cursor', 'pointer');
        indicatorBg.addEventListener('click', (e) => {
          e.stopPropagation();
          handleNodeClick(node.id);
        });
        g.appendChild(indicatorBg);

        const indicatorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        indicatorText.setAttribute('x', indicatorX + indicatorSize / 2);
        indicatorText.setAttribute('y', indicatorY + indicatorSize / 2);
        indicatorText.setAttribute('text-anchor', 'middle');
        indicatorText.setAttribute('dominant-baseline', 'middle');
        indicatorText.setAttribute('fill', borderColor);
        indicatorText.setAttribute('font-size', '14');
        indicatorText.setAttribute('font-weight', '500');
        indicatorText.setAttribute('font-family', '"Google Sans", "Product Sans", Inter, Roboto, Arial, sans-serif');
        indicatorText.setAttribute('text-rendering', 'optimizeLegibility');
        indicatorText.setAttribute('pointer-events', 'none');
        indicatorText.textContent = isCollapsed ? '+' : '−';
        g.appendChild(indicatorText);
      }

      svgElement.appendChild(g);
    });
  };

  useEffect(() => {
    if (!parsedNodes.length || !svgRef.current) {
      return;
    }

    setIsRendering(true);
    renderMindmap(svgRef.current);
    setIsRendering(false);
  }, [parsedNodes, connections, bounds, collapsedNodes]);

  useEffect(() => {
    if (isFullscreen && fullscreenSvgRef.current && parsedNodes.length) {
      renderMindmap(fullscreenSvgRef.current);
    }
  }, [isFullscreen, parsedNodes, connections, bounds, collapsedNodes]);

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY * -0.001;
    const newScale = Math.min(Math.max(0.1, transform.scale + delta), 5);
    setTransform({ ...transform, scale: newScale });
  };

  const handleMouseDown = (e) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setTransform({
        ...transform,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const zoomIn = () => {
    setTransform({ ...transform, scale: Math.min(transform.scale * 1.3, 5) });
  };

  const zoomOut = () => {
    setTransform({ ...transform, scale: Math.max(transform.scale * 0.77, 0.1) });
  };

  const resetView = () => {
    setTransform({ x: 0, y: 0, scale: 1.2 });
  };

  const downloadAsSVG = () => {
    if (!svgRef.current) return;

    const svg = svgRef.current;
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = mindmapData?.document_name
      ? `${mindmapData.document_name.replace('.pdf', '')}_mindmap.svg`
      : 'mindmap.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadAsPNG = () => {
    if (!svgRef.current) return;

    const svg = svgRef.current;
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = svg.viewBox.baseVal.width * scale;
      canvas.height = svg.viewBox.baseVal.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        const pngUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = mindmapData?.document_name
          ? `${mindmapData.document_name.replace('.pdf', '')}_mindmap.png`
          : 'mindmap.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(pngUrl);
        URL.revokeObjectURL(url);
      });
    };
    img.src = url;
  };

  const downloadAsPDF = async () => {
    if (!svgRef.current || isExportingPDF) return;

    setIsExportingPDF(true);

    try {
      const svg = svgRef.current;
      const svgData = new XMLSerializer().serializeToString(svg);
     
      const viewBox = svg.viewBox.baseVal;
      const svgWidth = viewBox.width || svg.clientWidth || 2000;
      const svgHeight = viewBox.height || svg.clientHeight || 1500;

      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
     
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      const a4WidthMM = 297;
      const a4HeightMM = 210;
     
      const svgAspectRatio = svgWidth / svgHeight;
      const a4AspectRatio = a4WidthMM / a4HeightMM;

      let imgWidthMM, imgHeightMM;
      if (svgAspectRatio > a4AspectRatio) {
        imgWidthMM = a4WidthMM * 0.95;
        imgHeightMM = imgWidthMM / svgAspectRatio;
      } else {
        imgHeightMM = a4HeightMM * 0.95;
        imgWidthMM = imgHeightMM * svgAspectRatio;
      }

      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = svgWidth * scale;
      canvas.height = svgHeight * scale;
     
      const ctx = canvas.getContext('2d');
     
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
     
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imgData = canvas.toDataURL('image/png', 1.0);

      let pdf;
      const useLandscape = imgWidthMM > imgHeightMM;
     
      if (imgWidthMM <= a4WidthMM && imgHeightMM <= a4HeightMM) {
        pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4'
        });
      } else {
        pdf = new jsPDF({
          orientation: useLandscape ? 'landscape' : 'portrait',
          unit: 'mm',
          format: [imgWidthMM, imgHeightMM]
        });
      }

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const xOffset = (pageWidth - imgWidthMM) / 2;
      const yOffset = (pageHeight - imgHeightMM) / 2;

      pdf.addImage(imgData, 'PNG', xOffset, yOffset, imgWidthMM, imgHeightMM, undefined, 'FAST');

      const getMindmapTitle = () => {
        if (mindmapData?.document_name) {
          return mindmapData.document_name.replace('.pdf', '').replace(/[^a-zA-Z0-9]/g, '_');
        }
        if (mindmapData?.data?.label) {
          return mindmapData.data.label.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '_');
        }
        return 'Mindmap';
      };

      const title = getMindmapTitle();
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const filename = `Mindmap_${title}_${date}.pdf`;

      pdf.save(filename);

      URL.revokeObjectURL(url);
      setIsExportingPDF(false);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      setIsExportingPDF(false);
      alert('Failed to export PDF. Please try again.');
    }
  };

  if (!mindmapData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center p-8 rounded-2xl bg-white shadow-sm">
          <p className="text-lg mb-2 font-medium text-gray-700">No mindmap generated yet</p>
          <p className="text-sm text-gray-500">Use the controls in the left panel to generate a mindmap</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white" ref={containerRef}>
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={zoomIn}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 hover:shadow-sm"
            title="Zoom In"
          >
            <ZoomIn size={20} />
          </button>
          <button
            onClick={zoomOut}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 hover:shadow-sm"
            title="Zoom Out"
          >
            <ZoomOut size={20} />
          </button>
          <button
            onClick={resetView}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 hover:shadow-sm"
            title="Reset View"
          >
            <Maximize2 size={20} />
          </button>
          <div className="w-px h-6 bg-gray-300 mx-2" />
          <button
            onClick={() => setIsFullscreen(true)}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 hover:shadow-sm"
            title="Fullscreen View"
          >
            <Maximize2 size={20} />
          </button>
          <div className="w-px h-6 bg-gray-300 mx-2" />
          <button
            onClick={downloadAsPDF}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed hover:shadow-sm"
            title="Download as PDF"
            disabled={isRendering || isExportingPDF || !parsedNodes.length}
          >
            <Download size={20} />
          </button>
          <button
            onClick={downloadAsPNG}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed hover:shadow-sm"
            title="Download as PNG"
            disabled={isRendering || !parsedNodes.length}
          >
            <Download size={20} />
          </button>
          <button
            onClick={downloadAsPDF}
            className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed hover:shadow-sm"
            title="Download as PDF"
            disabled={isRendering || isExportingPDF || !parsedNodes.length}
          >
            {isExportingPDF ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <FileText size={20} />
            )}
          </button>
          <div className="ml-3 px-4 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl text-sm font-semibold text-indigo-700 border border-indigo-100">
            {Math.round(transform.scale * 100)}%
          </div>
        </div>
        {mindmapData.document_name && (
          <div className="text-sm text-gray-600 font-medium truncate max-w-md bg-gray-50 px-4 py-1.5 rounded-xl">
            {mindmapData.document_name}
          </div>
        )}
      </div>

      <div
        className="flex-1 overflow-hidden bg-white cursor-grab active:cursor-grabbing relative"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {(isRendering || isExportingPDF) && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-white bg-opacity-90">
            <div className="text-center p-8 bg-white rounded-2xl shadow-sm">
              <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mx-auto mb-3" />
              <p className="text-sm text-gray-600 font-medium">
                {isExportingPDF ? 'Exporting PDF...' : 'Rendering mindmap...'}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-50 border border-red-200 rounded-xl p-6 shadow-sm z-10 max-w-lg">
            <p className="text-sm text-red-700 font-semibold mb-2">Error rendering mindmap</p>
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {!isRendering && parsedNodes.length > 0 ? (
          <div className="w-full h-full flex items-center justify-center">
            <div
              className="w-full h-full"
              style={{
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                transformOrigin: 'center center',
                transition: 'transform 0.1s ease-out',
              }}
            >
              <svg
                ref={svgRef}
                className="w-full h-full bg-white"
              />
            </div>
          </div>
        ) : !isRendering && parsedNodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center p-8 bg-white rounded-2xl shadow-sm">
              <p className="text-lg mb-2 text-gray-600 font-medium">No nodes to display</p>
              <p className="text-sm text-gray-400">Parsed nodes: {parsedNodes.length}, Connections: {connections.length}</p>
              <p className="text-xs text-gray-400 mt-2">Check browser console for debugging info</p>
            </div>
          </div>
        ) : null}
      </div>

      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setFullscreenTransform({ x: 0, y: 0, scale: 0.7 })}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900"
                title="Reset View"
              >
                <Maximize2 size={20} />
              </button>
              <button
                onClick={() => setFullscreenTransform({ ...fullscreenTransform, scale: Math.min(fullscreenTransform.scale * 1.3, 5) })}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900"
                title="Zoom In"
              >
                <ZoomIn size={20} />
              </button>
              <button
                onClick={() => setFullscreenTransform({ ...fullscreenTransform, scale: Math.max(fullscreenTransform.scale * 0.77, 0.1) })}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900"
                title="Zoom Out"
              >
                <ZoomOut size={20} />
              </button>
              <div className="w-px h-6 bg-gray-300 mx-2" />
              <button
                onClick={downloadAsPDF}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 disabled:text-gray-400"
                title="Download as PDF"
                disabled={isRendering || isExportingPDF || !parsedNodes.length}
              >
                <Download size={20} />
              </button>
              <button
                onClick={downloadAsPNG}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 disabled:text-gray-400"
                title="Download as PNG"
                disabled={isRendering || !parsedNodes.length}
              >
                <Download size={20} />
              </button>
              <button
                onClick={downloadAsPDF}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900 disabled:text-gray-400"
                title="Download as PDF"
                disabled={isRendering || isExportingPDF || !parsedNodes.length}
              >
                {isExportingPDF ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <FileText size={20} />
                )}
              </button>
              <div className="ml-3 px-4 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl text-sm font-semibold text-indigo-700 border border-indigo-100">
                {Math.round(fullscreenTransform.scale * 100)}%
              </div>
            </div>
            <div className="flex items-center gap-4">
              {mindmapData.document_name && (
                <div className="text-sm text-gray-600 font-medium truncate max-w-md bg-gray-50 px-4 py-1.5 rounded-xl">
                  {mindmapData.document_name}
                </div>
              )}
              <button
                onClick={() => setIsFullscreen(false)}
                className="p-2.5 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700 hover:text-gray-900"
                title="Close Fullscreen"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div
            className="flex-1 overflow-hidden bg-white relative cursor-grab active:cursor-grabbing"
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY * -0.001;
              const newScale = Math.min(Math.max(0.1, fullscreenTransform.scale + delta), 5);
              setFullscreenTransform({ ...fullscreenTransform, scale: newScale });
            }}
            onMouseDown={(e) => {
              if (e.button === 0 && e.target.tagName !== 'rect' && e.target.tagName !== 'circle') {
                setIsDragging(true);
                setDragStart({
                  x: e.clientX - fullscreenTransform.x,
                  y: e.clientY - fullscreenTransform.y
                });
              }
            }}
            onMouseMove={(e) => {
              if (isDragging) {
                setFullscreenTransform({
                  ...fullscreenTransform,
                  x: e.clientX - dragStart.x,
                  y: e.clientY - dragStart.y,
                });
              }
            }}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            {!isRendering && parsedNodes.length > 0 ? (
              <div className="w-full h-full flex items-center justify-center">
                <div
                  className="w-full h-full"
                  style={{
                    transform: `translate(${fullscreenTransform.x}px, ${fullscreenTransform.y}px) scale(${fullscreenTransform.scale})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.1s ease-out',
                  }}
                >
                  <svg
                    ref={fullscreenSvgRef}
                    className="w-full h-full bg-white"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default MindmapViewer;