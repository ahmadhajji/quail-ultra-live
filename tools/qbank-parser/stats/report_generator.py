"""
Stats Report Generator

Generates interactive HTML reports with Chart.js visualizations
for QBank Parser statistics.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any


class StatsReportGenerator:
    """Generates beautiful, interactive HTML reports for parsing statistics."""
    
    def generate_html(self, stats: Dict[str, Any], output_path: Path) -> Path:
        """
        Generate an interactive HTML report with charts and tables.
        
        Args:
            stats: Statistics dictionary from StatsCollector.finalize()
            output_path: Where to save the HTML file
            
        Returns:
            Path to the generated file
        """
        html_content = self._build_html(stats)
        
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        return output_path
    
    def _build_html(self, stats: Dict[str, Any]) -> str:
        """Build the complete HTML document."""
        
        meta = stats.get('meta', {})
        parser = stats.get('parser', {})
        questions = stats.get('questions', {})
        ai_summary = stats.get('ai_summary', {})
        cost = stats.get('cost_estimate', {})
        ai_calls = stats.get('ai_calls', [])
        
        # Prepare chart data
        token_chart_data = self._prepare_token_chart_data(ai_calls)
        latency_chart_data = self._prepare_latency_chart_data(ai_calls)
        method_chart_data = ai_summary.get('calls_by_method', {})
        
        return f'''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QBank Parser Stats Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {{
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --text-primary: #f0f6fc;
            --text-secondary: #8b949e;
            --accent: #58a6ff;
            --accent-green: #3fb950;
            --accent-yellow: #d29922;
            --accent-red: #f85149;
            --accent-purple: #a371f7;
            --border: #30363d;
        }}
        
        [data-theme="light"] {{
            --bg-primary: #ffffff;
            --bg-secondary: #f6f8fa;
            --bg-tertiary: #eaeef2;
            --text-primary: #1f2328;
            --text-secondary: #656d76;
            --border: #d0d7de;
        }}
        
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
        }}
        
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }}
        
        header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border);
        }}
        
        h1 {{
            font-size: 1.75rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        
        .theme-toggle {{
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 0.5rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
        }}
        
        .meta-info {{
            color: var(--text-secondary);
            font-size: 0.875rem;
            margin-bottom: 2rem;
        }}
        
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}
        
        .stat-card {{
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 1.25rem;
        }}
        
        .stat-card .label {{
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-secondary);
            margin-bottom: 0.25rem;
        }}
        
        .stat-card .value {{
            font-size: 2rem;
            font-weight: 600;
            color: var(--accent);
        }}
        
        .stat-card .value.green {{ color: var(--accent-green); }}
        .stat-card .value.yellow {{ color: var(--accent-yellow); }}
        .stat-card .value.purple {{ color: var(--accent-purple); }}
        .stat-card .value.red {{ color: var(--accent-red); }}
        
        .stat-card .subtext {{
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
        }}
        
        .section {{
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-bottom: 1.5rem;
            overflow: hidden;
        }}
        
        .section-header {{
            padding: 1rem 1.25rem;
            border-bottom: 1px solid var(--border);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }}
        
        .section-header:hover {{
            background: var(--bg-tertiary);
        }}
        
        .section-content {{
            padding: 1.25rem;
        }}
        
        .section.collapsed .section-content {{
            display: none;
        }}
        
        .chart-container {{
            position: relative;
            height: 300px;
            width: 100%;
        }}
        
        .chart-row {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 1.5rem;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 0.875rem;
        }}
        
        th, td {{
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }}
        
        th {{
            background: var(--bg-tertiary);
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}
        
        tr:hover {{
            background: var(--bg-tertiary);
        }}
        
        .tag {{
            display: inline-block;
            padding: 0.125rem 0.5rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 500;
        }}
        
        .tag.text {{ background: rgba(88, 166, 255, 0.15); color: var(--accent); }}
        .tag.vision {{ background: rgba(163, 113, 247, 0.15); color: var(--accent-purple); }}
        .tag.classification {{ background: rgba(210, 153, 34, 0.15); color: var(--accent-yellow); }}
        .tag.success {{ background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }}
        .tag.error {{ background: rgba(248, 81, 73, 0.15); color: var(--accent-red); }}
        
        .cost-breakdown {{
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            text-align: center;
        }}
        
        .cost-item {{
            padding: 1rem;
            background: var(--bg-tertiary);
            border-radius: 6px;
        }}
        
        .cost-item .amount {{
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--accent-green);
        }}
        
        .cost-item .label {{
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
        }}
        
        footer {{
            margin-top: 3rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border);
            text-align: center;
            color: var(--text-secondary);
            font-size: 0.75rem;
        }}
        
        @media (max-width: 768px) {{
            .container {{ padding: 1rem; }}
            .stats-grid {{ grid-template-columns: repeat(2, 1fr); }}
            .chart-row {{ grid-template-columns: 1fr; }}
            .cost-breakdown {{ grid-template-columns: 1fr; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>📊 Stats for Nerds</h1>
            <button class="theme-toggle" onclick="toggleTheme()">🌙 Toggle Theme</button>
        </header>
        
        <div class="meta-info">
            <strong>Source:</strong> {meta.get('source_file', 'Unknown')} &nbsp;|&nbsp;
            <strong>Duration:</strong> {meta.get('duration_seconds', 0):.1f}s &nbsp;|&nbsp;
            <strong>Generated:</strong> {meta.get('generated_at', 'Unknown')[:19]}
        </div>
        
        <!-- Summary Stats -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="label">Total Slides</div>
                <div class="value">{parser.get('total_slides', 0)}</div>
                <div class="subtext">{parser.get('slides_with_images', 0)} with images</div>
            </div>
            <div class="stat-card">
                <div class="label">Questions Extracted</div>
                <div class="value green">{questions.get('valid_questions', 0)}</div>
                <div class="subtext">{questions.get('multi_question_slides', 0)} multi-question slides</div>
            </div>
            <div class="stat-card">
                <div class="label">AI API Calls</div>
                <div class="value purple">{ai_summary.get('total_calls', 0)}</div>
                <div class="subtext">{ai_summary.get('failed_calls', 0)} failed</div>
            </div>
            <div class="stat-card">
                <div class="label">Total Tokens</div>
                <div class="value">{ai_summary.get('total_tokens', 0):,}</div>
                <div class="subtext">{ai_summary.get('total_thinking_tokens', 0):,} thinking</div>
            </div>
            <div class="stat-card">
                <div class="label">Avg Latency</div>
                <div class="value yellow">{ai_summary.get('avg_latency_ms', 0):.0f}ms</div>
                <div class="subtext">{ai_summary.get('total_latency_ms', 0)/1000:.1f}s total</div>
            </div>
            <div class="stat-card">
                <div class="label">Estimated Cost</div>
                <div class="value green">${cost.get('total_cost_usd', 0):.4f}</div>
                <div class="subtext">Input + Output</div>
            </div>
        </div>
        
        <!-- Charts Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                📈 Token Usage & Latency Charts
                <span>▼</span>
            </div>
            <div class="section-content">
                <div class="chart-row">
                    <div>
                        <h3 style="margin-bottom: 1rem; font-size: 0.875rem; color: var(--text-secondary);">Tokens per Slide</h3>
                        <div class="chart-container">
                            <canvas id="tokenChart"></canvas>
                        </div>
                    </div>
                    <div>
                        <h3 style="margin-bottom: 1rem; font-size: 0.875rem; color: var(--text-secondary);">Latency per Call (ms)</h3>
                        <div class="chart-container">
                            <canvas id="latencyChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Method Breakdown -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                🔧 Extraction Method Breakdown
                <span>▼</span>
            </div>
            <div class="section-content">
                <div class="chart-row">
                    <div>
                        <div class="chart-container" style="height: 250px;">
                            <canvas id="methodChart"></canvas>
                        </div>
                    </div>
                    <div>
                        <table>
                            <tr><th>Method</th><th>Calls</th><th>Description</th></tr>
                            <tr>
                                <td><span class="tag text">text</span></td>
                                <td>{method_chart_data.get('text', 0)}</td>
                                <td>Standard text extraction with thinking mode</td>
                            </tr>
                            <tr>
                                <td><span class="tag vision">vision</span></td>
                                <td>{method_chart_data.get('vision', 0)}</td>
                                <td>Image/screenshot OCR extraction</td>
                            </tr>
                            <tr>
                                <td><span class="tag classification">classification</span></td>
                                <td>{method_chart_data.get('classification', 0)}</td>
                                <td>Slide type classification</td>
                            </tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Cost Breakdown -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                💰 Cost Breakdown
                <span>▼</span>
            </div>
            <div class="section-content">
                <div class="cost-breakdown">
                    <div class="cost-item">
                        <div class="amount">${cost.get('input_cost_usd', 0):.6f}</div>
                        <div class="label">Input Tokens ({ai_summary.get('total_prompt_tokens', 0):,})</div>
                    </div>
                    <div class="cost-item">
                        <div class="amount">${cost.get('output_cost_usd', 0):.6f}</div>
                        <div class="label">Output Tokens ({ai_summary.get('total_completion_tokens', 0):,})</div>
                    </div>
                    <div class="cost-item">
                        <div class="amount" style="color: var(--accent);">${cost.get('total_cost_usd', 0):.6f}</div>
                        <div class="label">Total Estimated</div>
                    </div>
                </div>
                <p style="margin-top: 1rem; font-size: 0.75rem; color: var(--text-secondary); text-align: center;">
                    {cost.get('pricing_note', '')}
                </p>
            </div>
        </div>
        
        <!-- Detailed AI Calls Log -->
        <div class="section collapsed">
            <div class="section-header" onclick="toggleSection(this)">
                📋 Detailed AI Calls Log ({len(ai_calls)} calls)
                <span>▶</span>
            </div>
            <div class="section-content">
                <div style="overflow-x: auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Slide</th>
                                <th>Method</th>
                                <th>Prompt</th>
                                <th>Completion</th>
                                <th>Total</th>
                                <th>Latency</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {self._generate_calls_table_rows(ai_calls)}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <footer>
            Generated by QBank Parser • Stats for Nerds v1.0
        </footer>
    </div>
    
    <script>
        // Theme toggle
        function toggleTheme() {{
            const html = document.documentElement;
            const current = html.getAttribute('data-theme');
            html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
            initCharts();
        }}
        
        // Section collapse
        function toggleSection(header) {{
            const section = header.parentElement;
            section.classList.toggle('collapsed');
            const arrow = header.querySelector('span');
            arrow.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
        }}
        
        // Chart.js setup
        const tokenData = {json.dumps(token_chart_data)};
        const latencyData = {json.dumps(latency_chart_data)};
        const methodData = {json.dumps(method_chart_data)};
        
        let tokenChart, latencyChart, methodChart;
        
        function getChartColors() {{
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            return {{
                text: isDark ? '#f0f6fc' : '#1f2328',
                grid: isDark ? '#30363d' : '#d0d7de',
                accent: '#58a6ff',
                green: '#3fb950',
                purple: '#a371f7',
                yellow: '#d29922'
            }};
        }}
        
        function initCharts() {{
            const colors = getChartColors();
            
            // Destroy existing charts
            if (tokenChart) tokenChart.destroy();
            if (latencyChart) latencyChart.destroy();
            if (methodChart) methodChart.destroy();
            
            // Token Chart
            const tokenCtx = document.getElementById('tokenChart').getContext('2d');
            tokenChart = new Chart(tokenCtx, {{
                type: 'bar',
                data: {{
                    labels: tokenData.labels,
                    datasets: [
                        {{
                            label: 'Prompt Tokens',
                            data: tokenData.prompt,
                            backgroundColor: colors.accent + '80',
                            borderColor: colors.accent,
                            borderWidth: 1
                        }},
                        {{
                            label: 'Completion Tokens',
                            data: tokenData.completion,
                            backgroundColor: colors.green + '80',
                            borderColor: colors.green,
                            borderWidth: 1
                        }}
                    ]
                }},
                options: {{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {{
                        x: {{ 
                            stacked: true,
                            ticks: {{ color: colors.text }},
                            grid: {{ color: colors.grid }}
                        }},
                        y: {{ 
                            stacked: true,
                            ticks: {{ color: colors.text }},
                            grid: {{ color: colors.grid }}
                        }}
                    }},
                    plugins: {{
                        legend: {{ labels: {{ color: colors.text }} }}
                    }}
                }}
            }});
            
            // Latency Chart
            const latencyCtx = document.getElementById('latencyChart').getContext('2d');
            latencyChart = new Chart(latencyCtx, {{
                type: 'line',
                data: {{
                    labels: latencyData.labels,
                    datasets: [{{
                        label: 'Latency (ms)',
                        data: latencyData.values,
                        borderColor: colors.yellow,
                        backgroundColor: colors.yellow + '20',
                        fill: true,
                        tension: 0.3
                    }}]
                }},
                options: {{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {{
                        x: {{ 
                            ticks: {{ color: colors.text }},
                            grid: {{ color: colors.grid }}
                        }},
                        y: {{ 
                            ticks: {{ color: colors.text }},
                            grid: {{ color: colors.grid }}
                        }}
                    }},
                    plugins: {{
                        legend: {{ labels: {{ color: colors.text }} }}
                    }}
                }}
            }});
            
            // Method Chart
            const methodCtx = document.getElementById('methodChart').getContext('2d');
            methodChart = new Chart(methodCtx, {{
                type: 'doughnut',
                data: {{
                    labels: ['Text', 'Vision', 'Classification'],
                    datasets: [{{
                        data: [methodData.text || 0, methodData.vision || 0, methodData.classification || 0],
                        backgroundColor: [colors.accent, colors.purple, colors.yellow],
                        borderWidth: 0
                    }}]
                }},
                options: {{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {{
                        legend: {{ 
                            position: 'bottom',
                            labels: {{ color: colors.text }}
                        }}
                    }}
                }}
            }});
        }}
        
        // Initialize on load
        document.addEventListener('DOMContentLoaded', initCharts);
    </script>
</body>
</html>'''
    
    def _prepare_token_chart_data(self, ai_calls: list) -> dict:
        """Prepare data for the token usage chart."""
        labels = []
        prompt_tokens = []
        completion_tokens = []
        
        for call in ai_calls:
            labels.append(f"Slide {call.get('slide_number', '?')}")
            prompt_tokens.append(call.get('prompt_tokens', 0))
            completion_tokens.append(call.get('completion_tokens', 0))
        
        # Limit to reasonable number of points for readability
        if len(labels) > 50:
            step = len(labels) // 50
            labels = labels[::step]
            prompt_tokens = prompt_tokens[::step]
            completion_tokens = completion_tokens[::step]
        
        return {
            'labels': labels,
            'prompt': prompt_tokens,
            'completion': completion_tokens
        }
    
    def _prepare_latency_chart_data(self, ai_calls: list) -> dict:
        """Prepare data for the latency chart."""
        labels = []
        values = []
        
        for i, call in enumerate(ai_calls):
            labels.append(f"Call {i+1}")
            values.append(call.get('latency_ms', 0))
        
        # Limit points
        if len(labels) > 50:
            step = len(labels) // 50
            labels = labels[::step]
            values = values[::step]
        
        return {
            'labels': labels,
            'values': values
        }
    
    def _generate_calls_table_rows(self, ai_calls: list) -> str:
        """Generate HTML table rows for AI calls."""
        rows = []
        
        for call in ai_calls:
            method_class = call.get('method', 'text')
            status_class = 'success' if call.get('success', True) else 'error'
            status_text = '✓' if call.get('success', True) else call.get('error', 'Error')[:30]
            
            row = f'''<tr>
                <td>{call.get('slide_number', '?')}</td>
                <td><span class="tag {method_class}">{method_class}</span></td>
                <td>{call.get('prompt_tokens', 0):,}</td>
                <td>{call.get('completion_tokens', 0):,}</td>
                <td>{call.get('total_tokens', 0):,}</td>
                <td>{call.get('latency_ms', 0):.0f}ms</td>
                <td><span class="tag {status_class}">{status_text}</span></td>
            </tr>'''
            rows.append(row)
        
        return '\n'.join(rows)
    
    def generate_markdown(self, stats: Dict[str, Any], output_path: Path) -> Path:
        """
        Generate a markdown summary report (fallback format).
        
        Args:
            stats: Statistics dictionary
            output_path: Where to save the markdown file
            
        Returns:
            Path to the generated file
        """
        meta = stats.get('meta', {})
        parser = stats.get('parser', {})
        questions = stats.get('questions', {})
        ai_summary = stats.get('ai_summary', {})
        cost = stats.get('cost_estimate', {})
        
        md_content = f'''# 📊 QBank Parser Stats Report

**Source:** `{meta.get('source_file', 'Unknown')}`  
**Duration:** {meta.get('duration_seconds', 0):.1f} seconds  
**Generated:** {meta.get('generated_at', 'Unknown')[:19]}

---

## Summary

| Metric | Value |
|--------|-------|
| Total Slides | {parser.get('total_slides', 0)} |
| Questions Extracted | {questions.get('valid_questions', 0)} |
| Multi-Question Slides | {questions.get('multi_question_slides', 0)} |
| Vision Extractions | {questions.get('vision_extractions', 0)} |
| Average Confidence | {questions.get('avg_confidence', 0):.1f}% |

---

## AI API Usage

| Metric | Value |
|--------|-------|
| Total API Calls | {ai_summary.get('total_calls', 0)} |
| Successful Calls | {ai_summary.get('successful_calls', 0)} |
| Failed Calls | {ai_summary.get('failed_calls', 0)} |
| Total Tokens | {ai_summary.get('total_tokens', 0):,} |
| Prompt Tokens | {ai_summary.get('total_prompt_tokens', 0):,} |
| Completion Tokens | {ai_summary.get('total_completion_tokens', 0):,} |
| Thinking Tokens | {ai_summary.get('total_thinking_tokens', 0):,} |
| Avg Latency | {ai_summary.get('avg_latency_ms', 0):.0f}ms |
| Total Latency | {ai_summary.get('total_latency_ms', 0)/1000:.1f}s |

### Calls by Method

- **Text:** {ai_summary.get('calls_by_method', {}).get('text', 0)}
- **Vision:** {ai_summary.get('calls_by_method', {}).get('vision', 0)}
- **Classification:** {ai_summary.get('calls_by_method', {}).get('classification', 0)}

---

## Cost Estimate

| Type | Amount |
|------|--------|
| Input Cost | ${cost.get('input_cost_usd', 0):.6f} |
| Output Cost | ${cost.get('output_cost_usd', 0):.6f} |
| **Total** | **${cost.get('total_cost_usd', 0):.6f}** |

> {cost.get('pricing_note', '')}

---

*Generated by QBank Parser Stats for Nerds v1.0*
'''
        
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
        
        return output_path
