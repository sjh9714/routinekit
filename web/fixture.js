(() => {
  const api = document.modelContext || navigator.modelContext;
  const status = document.querySelector('#capability');
  if (!api?.registerTool) { status.textContent = 'Native WebMCP is unavailable. Use a current Chromium browser with experimental web-platform features enabled.'; return; }
  const show = (id, value) => { document.getElementById(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
  const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  const text = { type: 'string' }; const number = { type: 'number' };
  const catalog = [{ id: 'project-pine', name: 'Pine Notes', category: 'notes' }, { id: 'project-tide', name: 'Tide Timer', category: 'timer' }, { id: 'project-moss', name: 'Moss Sketch', category: 'drawing' }];
  const cities = { seoul: [{ id: 'activity-han', title: 'Walk beside the Han River' }], tokyo: [{ id: 'activity-ueno', title: 'Sketch in Ueno Park' }], london: [{ id: 'activity-tate', title: 'Visit Tate Modern' }] };
  const tools = [
    { name: 'catalog_search', description: 'Find one sample project by category: notes, timer, drawing.', inputSchema: schema({ category: text }), execute: ({ category }) => { const result = { query: category, items: catalog.filter(p => p.category === category) }; show('catalog', result); return result; } },
    { name: 'catalog_open', description: 'Open a sample project by the id returned by catalog_search.', inputSchema: schema({ id: text }), execute: ({ id }) => { const item = catalog.find(p => p.id === id); if (!item) throw new Error('Missing project'); const result = { ...item, opened: true }; show('catalog', `${result.name}\nCategory: ${result.category}\nOpened successfully`); return result; } },
    { name: 'city_activities', description: 'List one sample activity for seoul, tokyo, or london.', inputSchema: schema({ city: text }), execute: ({ city }) => { const result = { city, activities: cities[city] || [] }; show('planner', result); return result; } },
    { name: 'plan_activity', description: 'Display a sample itinerary using a returned activity id. Does not book anything.', inputSchema: schema({ activity_id: text, city: text }), execute: ({ activity_id, city }) => { const activity = cities[city]?.find(a => a.id === activity_id); if (!activity) throw new Error('Activity does not match city'); const result = { city, activity: activity.title, ready: true }; show('planner', `${city.toUpperCase()}\n${activity.title}\nYour local plan is ready`); return result; } },
    { name: 'convert_distance', description: 'Convert a distance in kilometres into miles.', inputSchema: schema({ kilometres: number }), execute: ({ kilometres }) => { const result = { kilometres, miles: Number((kilometres * 0.621371).toFixed(3)), unit: 'miles' }; show('converter', result); return result; } },
    { name: 'format_distance', description: 'Format a converted distance.', inputSchema: schema({ miles: number }), execute: ({ miles }) => { const result = { miles, label: `${miles} miles`, formatted: true }; show('converter', result.label); return result; } },
  ];
  Promise.all(tools.map(tool => api.registerTool(tool))).then(() => { status.textContent = `${tools.length} native WebMCP tools registered · ready for RoutineKit`; }).catch(() => { status.textContent = 'WebMCP registration failed. Check browser support and flags.'; });
})();
