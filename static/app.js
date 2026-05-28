const API_BASE = 'http://localhost:8765';
let currentMonth = new Date();
let trendChart = null;
let detailUsageChart = null;
let categoryPieChart = null;
let csvCandidates = [];
let currentDetailId = null;

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initForms();
    initDates();
    loadDashboard();
    loadSubscriptions();
    loadCalendar();
    loadBillingRecords();
    loadUsageOptions();
    loadCostEffectiveness();
    loadRenewalCountdown();
    loadSavingTips();
    loadArticles();
    loadCancellationGuides();
    loadScreenshots();
    compareServices();
});

function initTabs() {
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = e.currentTarget.dataset.tab;
            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.currentTarget.classList.add('active');
            document.getElementById(tab).classList.add('active');
            if (tab === 'dashboard') loadDashboard();
            if (tab === 'subscriptions') loadSubscriptions();
            if (tab === 'billing') { loadCalendar(); loadBillingRecords(); }
            if (tab === 'usage') { loadUsageOptions(); loadCostEffectiveness(); }
            if (tab === 'renewal') loadRenewalCountdown();
            if (tab === 'backup') { loadCancellationGuides(); loadScreenshots(); }
            if (tab === 'discover') { loadSavingTips(); loadArticles(); }
        });
    });
}

function initForms() {
    document.getElementById('add-sub-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.price = parseFloat(data.price);
        data.billing_day = parseInt(data.billing_day) || null;
        data.auto_renewal = formData.has('auto_renewal');
        data.is_trial = formData.has('is_trial');
        await fetch(`${API_BASE}/subscriptions/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        closeModal('add-sub-modal');
        e.target.reset();
        loadSubscriptions();
        loadDashboard();
        loadAllSubOptions();
    });

    document.getElementById('add-billing-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.subscription_id = parseInt(data.subscription_id);
        data.amount = parseFloat(data.amount);
        await fetch(`${API_BASE}/billing-records/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        closeModal('add-billing-modal');
        e.target.reset();
        loadBillingRecords();
        loadDashboard();
        if (currentDetailId) viewSubscription(currentDetailId);
    });

    document.getElementById('add-shared-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.subscription_id = parseInt(data.subscription_id);
        data.share_amount = parseFloat(data.share_amount);
        await fetch(`${API_BASE}/shared-members/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        closeModal('add-shared-member-modal');
        e.target.reset();
        loadSharedMembers();
    });

    document.getElementById('edit-guide-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.subscription_id = parseInt(data.subscription_id);
        await fetch(`${API_BASE}/cancellation-guides/${data.subscription_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        closeModal('edit-cancellation-guide-modal');
        e.target.reset();
        loadCancellationGuides();
    });
}

function initDates() {
    const today = new Date().toISOString().split('T')[0];
    document.querySelector('[name="subscription_date"]').value = today;
    document.querySelector('[name="billing_date"]').value = today;
    document.getElementById('screenshot-month').value = new Date().toISOString().slice(0, 7);
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
    if (id === 'add-billing-modal') loadBillingSubOptions();
    if (id === 'add-shared-member-modal') loadSharedSubOptions();
    if (id === 'edit-cancellation-guide-modal') loadGuideSubOptions();
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function toggleTrial() {
    document.getElementById('trial-end-field').classList.toggle('hidden');
}

async function fetchFavicon() {
    const name = document.querySelector('[name="name"]').value;
    if (!name) return;
    try {
        const res = await fetch(`${API_BASE}/favicon?url=${name}.com`);
        const data = await res.json();
        document.getElementById('icon_url').value = data.icon_url;
    } catch (e) {
        console.log('Could not fetch favicon');
    }
}

async function loadAllSubOptions() {
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    const selects = ['billing-sub-select', 'usage-sub', 'shared-sub-select', 'guide-sub-select', 'screenshot-sub-id'];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    });
}

async function loadDashboard() {
    const [subs, reminders, idle, trends] = await Promise.all([
        fetch(`${API_BASE}/subscriptions/`).then(r => r.json()),
        fetch(`${API_BASE}/reminders/`).then(r => r.json()),
        fetch(`${API_BASE}/idle-alerts/`).then(r => r.json()),
        fetch(`${API_BASE}/billing-trends/`).then(r => r.json())
    ]);

    const monthlyTotal = subs.reduce((sum, sub) => sum + getMonthlyPrice(sub), 0);

    document.getElementById('monthly-total').textContent = `¥${monthlyTotal.toFixed(2)}`;
    document.getElementById('active-subs').textContent = subs.length;
    document.getElementById('upcoming-renewals').textContent = reminders.length;
    document.getElementById('idle-alerts').textContent = idle.length;

    if (trendChart) trendChart.destroy();
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trends.map(t => t.month),
            datasets: [{
                label: '月度支出',
                data: trends.map(t => t.total),
                borderColor: '#4f46e5',
                fill: true,
                backgroundColor: 'rgba(79, 70, 229, 0.1)'
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });

    document.getElementById('upcoming-list').innerHTML = reminders.map(r => `
        <div class="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
            <div>
                <p class="font-medium">${r.name}</p>
                <p class="text-sm text-gray-500">${r.message}</p>
            </div>
            <span class="text-orange-600 font-bold">${r.days_until}天</span>
        </div>
    `).join('') || '<p class="text-gray-500">暂无即将扣费的订阅</p>';

    document.getElementById('idle-list').innerHTML = idle.map(sub => `
        <div class="flex items-center justify-between p-3 bg-red-50 rounded-lg">
            <div class="flex items-center gap-3">
                ${sub.icon_url ? `<img src="${sub.icon_url}" class="w-10 h-10 rounded">` : '<div class="w-10 h-10 bg-gray-200 rounded"></div>'}
                <div>
                    <p class="font-medium">${sub.name}</p>
                    <p class="text-sm text-gray-500">上次使用: ${sub.last_used || '从未使用'}</p>
                </div>
            </div>
            <button class="text-red-600 text-sm hover:underline" onclick="deleteSubscription(${sub.subscription_id})">取消订阅</button>
        </div>
    `).join('') || '<p class="text-gray-500">暂无闲置订阅</p>';
}

function getMonthlyPrice(sub) {
    let monthly = sub.price;
    if (sub.billing_cycle === 'quarter') monthly /= 3;
    if (sub.billing_cycle === 'half_year') monthly /= 6;
    if (sub.billing_cycle === 'year') monthly /= 12;
    return monthly;
}

async function loadSubscriptions() {
    const typeFilter = document.getElementById('type-filter').value;
    const search = document.getElementById('sub-search').value.toLowerCase();
    
    let url = `${API_BASE}/subscriptions/`;
    if (typeFilter) url += `?service_type=${typeFilter}`;
    
    const subs = await fetch(url).then(r => r.json());
    const filtered = subs.filter(s => s.name.toLowerCase().includes(search));
    const cycleText = { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' };

    document.getElementById('subscriptions-grid').innerHTML = filtered.map(sub => `
        <div class="bg-white p-6 rounded-xl shadow hover:shadow-lg transition">
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    ${sub.icon_url ? `<img src="${sub.icon_url}" class="w-12 h-12 rounded-lg" onerror="this.style.display='none'">` : '<div class="w-12 h-12 bg-gray-200 rounded-lg"></div>'}
                    <div>
                        <h3 class="font-bold">${sub.name}</h3>
                        <span class="text-xs bg-gray-100 px-2 py-1 rounded">${sub.service_type}</span>
                    </div>
                </div>
                <div class="text-right">
                    <p class="font-bold text-lg">¥${sub.price}</p>
                    <p class="text-xs text-gray-500">${cycleText[sub.billing_cycle]} (¥${getMonthlyPrice(sub).toFixed(2)}/月)</p>
                </div>
            </div>
            <div class="text-sm text-gray-500 space-y-1">
                <p>供应商: ${sub.provider || '-'}</p>
                <p>扣款日: 每月${sub.billing_day || '-'}日</p>
                <p>自动续费: ${sub.auto_renewal ? '✅ 开启' : '❌ 关闭'}</p>
            </div>
            <div class="flex gap-2 mt-4">
                <button onclick="viewSubscription(${sub.id})" class="flex-1 bg-indigo-50 text-indigo-600 py-2 rounded hover:bg-indigo-100 text-sm">详情</button>
                <button onclick="deleteSubscription(${sub.id})" class="flex-1 bg-red-50 text-red-600 py-2 rounded hover:bg-red-100 text-sm">删除</button>
            </div>
        </div>
    `).join('') || '<div class="col-span-3 text-center py-12 text-gray-500">暂无订阅记录</div>';
    
    loadAllSubOptions();
}

async function viewSubscription(id) {
    currentDetailId = id;
    const [sub, stats, bills] = await Promise.all([
        fetch(`${API_BASE}/subscriptions/${id}`).then(r => r.json()),
        fetch(`${API_BASE}/usage-stats/${id}`).then(r => r.json()),
        fetch(`${API_BASE}/billing-records/?subscription_id=${id}`).then(r => r.json())
    ]);

    document.getElementById('detail-icon').src = sub.icon_url || 'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
    document.getElementById('detail-name').textContent = sub.name;
    document.getElementById('detail-type').textContent = sub.service_type;

    const cycleText = { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' };
    document.getElementById('detail-basic-info').innerHTML = `
        <div class="flex justify-between"><span class="text-gray-500">供应商</span><span>${sub.provider || '-'}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">订阅日期</span><span>${sub.subscription_date || '-'}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">扣款周期</span><span>${cycleText[sub.billing_cycle]}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">价格</span><span class="font-bold">¥${sub.price}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">月均价格</span><span class="font-bold text-indigo-600">¥${getMonthlyPrice(sub).toFixed(2)}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">扣款日</span><span>每月${sub.billing_day || '-'}日</span></div>
        <div class="flex justify-between"><span class="text-gray-500">支付方式</span><span>${sub.payment_method || '-'}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">自动续费</span><span>${sub.auto_renewal ? '✅ 开启' : '❌ 关闭'}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">距下次续费</span><span class="font-bold">${sub.days_until_renewal || '-'}天</span></div>
    `;

    const costPerUse = stats.cost_per_use || 0;
    const costLevel = costPerUse > 10 ? 'bg-red-100 text-red-600' : costPerUse > 5 ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600';
    document.getElementById('detail-cost-effectiveness').innerHTML = `
        <div class="text-center">
            <p class="text-3xl font-bold ${costPerUse === Infinity ? 'text-red-600' : ''}">¥${costPerUse === Infinity ? '∞' : costPerUse.toFixed(2)}</p>
            <p class="text-sm text-gray-500 mt-1">单次使用成本</p>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div class="text-center">
                <p class="font-bold">${stats.monthly_usage_count || 0}次</p>
                <p class="text-gray-500">本月使用</p>
            </div>
            <div class="text-center">
                <p class="font-bold">${stats.monthly_duration_minutes || 0}分钟</p>
                <p class="text-gray-500">本月时长</p>
            </div>
        </div>
        <div class="mt-4 p-2 rounded text-sm text-center ${costLevel}">
            ${costPerUse > 10 ? '⚠️ 使用频率低，建议考虑降级或取消' : '✅ 使用情况良好'}
        </div>
    `;

    if (detailUsageChart) detailUsageChart.destroy();
    const ctx = document.getElementById('detail-usage-chart').getContext('2d');
    const days = Object.keys(stats.heatmap || {}).sort();
    detailUsageChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days.slice(-14),
            datasets: [{
                label: '使用次数',
                data: days.slice(-14).map(d => stats.heatmap[d] || 0),
                backgroundColor: '#4f46e5'
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });

    document.getElementById('detail-billing-history').innerHTML = bills.slice(0, 10).map(b => `
        <div class="flex items-center justify-between p-3 border rounded-lg">
            <span class="text-gray-500">${b.billing_date}</span>
            <span class="${b.status === 'failed' ? 'text-red-600' : ''}">¥${b.amount.toFixed(2)}</span>
            <span class="text-xs ${b.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'} px-2 py-1 rounded">${b.status === 'failed' ? '失败' : '成功'}</span>
        </div>
    `).join('') || '<p class="text-gray-500 text-center py-4">暂无扣费记录</p>';

    openModal('subscription-detail-panel');
}

async function deleteSubscription(id) {
    if (confirm('确定删除此订阅？')) {
        await fetch(`${API_BASE}/subscriptions/${id}`, { method: 'DELETE' });
        loadSubscriptions();
        loadDashboard();
    }
}

async function loadCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth() + 1;
    document.getElementById('calendar-month').textContent = `${year}年${month}月`;
    const data = await fetch(`${API_BASE}/billing-calendar/?year=${year}&month=${month}`).then(r => r.json());
    
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    
    let html = ['日', '一', '二', '三', '四', '五', '六'].map(d => 
        `<div class="text-center font-medium text-gray-500 py-2">${d}</div>`
    ).join('');
    
    for (let i = 0; i < firstDay; i++) html += '<div></div>';
    
    for (let day = 1; day <= daysInMonth; day++) {
        const bills = data.calendar[day] || [];
        html += `
            <div class="text-center py-2 rounded ${bills.length ? 'bg-indigo-100 font-medium' : ''} hover:bg-gray-50 cursor-pointer relative group">
                ${day}
                ${bills.length ? `<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 text-white text-xs p-2 rounded whitespace-nowrap hidden group-hover:block z-10">
                    ${bills.map(b => `${b.name}: ¥${b.amount.toFixed(2)}`).join('<br>')}
                </div>` : ''}
            </div>
        `;
    }
    
    document.getElementById('calendar-grid').innerHTML = html;
    document.getElementById('calendar-total').textContent = `¥${data.total_monthly.toFixed(2)}`;
}

function changeMonth(delta) {
    currentMonth.setMonth(currentMonth.getMonth() + delta);
    loadCalendar();
}

async function loadBillingRecords() {
    const records = await fetch(`${API_BASE}/billing-records/`).then(r => r.json());
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    const subMap = Object.fromEntries(subs.map(s => [s.id, s]));
    
    document.getElementById('billing-records').innerHTML = records.map(r => `
        <div class="flex items-center justify-between p-3 border rounded-lg">
            <div>
                <p class="font-medium">${subMap[r.subscription_id]?.name || '未知'}</p>
                <p class="text-sm text-gray-500">${r.billing_date}</p>
            </div>
            <div class="text-right">
                <p class="font-bold ${r.status === 'failed' ? 'text-red-600' : ''}">¥${r.amount.toFixed(2)}</p>
                <p class="text-xs ${r.status === 'failed' ? 'text-red-500' : 'text-green-500'}">${r.status === 'failed' ? '扣款失败' : '成功'}</p>
            </div>
        </div>
    `).join('') || '<p class="text-gray-500">暂无记录</p>';
}

async function loadBillingSubOptions() {
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    document.getElementById('billing-sub-select').innerHTML = subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

async function setBudget() {
    const year = parseInt(document.getElementById('budget-year').value);
    const amount = parseFloat(document.getElementById('budget-amount').value);
    await fetch(`${API_BASE}/budget/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, amount, category: 'all' })
    });
    const data = await fetch(`${API_BASE}/budget/${year}`).then(r => r.json());
    document.getElementById('budget-display').innerHTML = `
        <div class="flex gap-8">
            <div><p class="text-sm text-gray-500">年度预算</p><p class="text-2xl font-bold">¥${data.budget.toFixed(2)}</p></div>
            <div><p class="text-sm text-gray-500">实际支出</p><p class="text-2xl font-bold ${data.actual > data.budget ? 'text-red-600' : 'text-green-600'}">¥${data.actual.toFixed(2)}</p></div>
            <div><p class="text-sm text-gray-500">差额</p><p class="text-2xl font-bold ${data.difference >= 0 ? 'text-green-600' : 'text-red-600'}">${data.difference >= 0 ? '+' : ''}¥${data.difference.toFixed(2)}</p></div>
        </div>
        <div class="mt-4 bg-gray-200 rounded-full h-4"><div class="bg-indigo-600 h-4 rounded-full" style="width: ${Math.min(data.actual / data.budget * 100, 100)}%"></div></div>
    `;
}

async function loadUsageOptions() {
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    document.getElementById('usage-sub').innerHTML = subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

async function recordUsage() {
    const subscription_id = parseInt(document.getElementById('usage-sub').value);
    const duration_minutes = parseInt(document.getElementById('usage-minutes').value) || null;
    const usage_count = parseInt(document.getElementById('usage-count').value) || 1;
    await fetch(`${API_BASE}/usage-records/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_id, usage_date: new Date().toISOString().split('T')[0], duration_minutes, usage_count })
    });
    document.getElementById('usage-minutes').value = '';
    document.getElementById('usage-count').value = '1';
    loadCostEffectiveness();
    loadDashboard();
    if (currentDetailId) viewSubscription(currentDetailId);
}

async function loadCostEffectiveness() {
    const data = await fetch(`${API_BASE}/cost-effectiveness/`).then(r => r.json());
    document.getElementById('cost-effectiveness').innerHTML = data.slice(0, 10).map((item, idx) => `
        <div class="flex items-center justify-between p-3 ${idx === 0 ? 'bg-red-50 border-l-4 border-red-500' : 'border-l-4 border-gray-200'}">
            <div class="flex items-center gap-3">
                <span class="text-2xl">${idx === 0 ? '⚠️' : idx + 1}</span>
                <div>
                    <p class="font-medium">${item.name}</p>
                    <p class="text-sm text-gray-500">月均 ¥${item.monthly_price.toFixed(2)} · 使用 ${item.usage_count} 次</p>
                </div>
            </div>
            <div class="text-right">
                <p class="font-bold">¥${item.cost_per_use === Infinity ? '∞' : item.cost_per_use?.toFixed(2) || '-'}/次</p>
                <p class="text-xs ${item.recommendation.includes('取消') ? 'text-red-600' : 'text-green-600'}">${item.recommendation}</p>
            </div>
        </div>
    `).join('');

    if (data.length > 0) {
        const stats = data[0];
        document.getElementById('usage-stats').innerHTML = `
            <div class="p-4 bg-red-50 rounded-lg">
                <p class="text-sm text-red-600 font-medium">💡 省钱建议</p>
                <p class="mt-1">你本月 <strong>${stats.name}</strong> 会员花了 ¥${stats.monthly_price.toFixed(2)} 只用了 ${stats.usage_count} 次</p>
                <p class="text-sm text-red-500 mt-1">单次成本高达 ¥${stats.cost_per_use === Infinity ? '∞' : stats.cost_per_use?.toFixed(2)}，可以考虑降级或取消</p>
            </div>
        `;
    }
}

async function loadRenewalCountdown() {
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    const withCountdown = subs.map(sub => ({ ...sub, days: sub.days_until_renewal }));
    withCountdown.sort((a, b) => (a.days ?? 999) - (b.days ?? 999));

    document.getElementById('renewal-countdown').innerHTML = withCountdown.slice(0, 8).map(sub => {
        const days = sub.days || 30;
        const borderColor = days <= 3 ? 'border-red-500' : days <= 7 ? 'border-orange-500' : 'border-green-500';
        const gradientColor = days <= 3 ? '#ef4444' : days <= 7 ? '#f97316' : '#22c55e';
        const textColor = days <= 3 ? 'text-red-600' : days <= 7 ? 'text-orange-600' : 'text-green-600';
        return `
            <div class="text-center">
                <div class="renewal-ring mx-auto mb-2 bg-gray-100 border-4 ${borderColor}" style="background: conic-gradient(${gradientColor} ${days / 30 * 360}deg, #e5e7eb 0deg)">
                    <div class="w-16 h-16 bg-white rounded-full flex items-center justify-center">
                        <span class="text-xl font-bold ${textColor}">${days}</span>
                    </div>
                </div>
                <p class="font-medium text-sm truncate">${sub.name}</p>
                <p class="text-xs text-gray-500">天后续费</p>
            </div>
        `;
    }).join('');

    document.getElementById('renewal-decisions').innerHTML = withCountdown.filter(s => s.days <= 7).map(sub => `
        <div class="flex items-center justify-between p-4 border rounded-lg">
            <div class="flex items-center gap-4">
                ${sub.icon_url ? `<img src="${sub.icon_url}" class="w-12 h-12 rounded">` : '<div class="w-12 h-12 bg-gray-200 rounded"></div>'}
                <div>
                    <p class="font-bold">${sub.name}</p>
                    <p class="text-sm text-gray-500">¥${sub.price}/${{month:'月',quarter:'季',half_year:'半年',year:'年'}[sub.billing_cycle]} · ${sub.days}天后续费</p>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="makeDecision(${sub.id}, 'renew')" class="px-4 py-2 bg-green-100 text-green-600 rounded hover:bg-green-200">续费</button>
                <button onclick="makeDecision(${sub.id}, 'downgrade')" class="px-4 py-2 bg-yellow-100 text-yellow-600 rounded hover:bg-yellow-200">降级</button>
                <button onclick="makeDecision(${sub.id}, 'cancel')" class="px-4 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200">取消</button>
                <button onclick="makeDecision(${sub.id}, 'pause')" class="px-4 py-2 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">暂停</button>
            </div>
        </div>
    `).join('') || '<p class="text-gray-500">暂无需要决策的续费</p>';

    const trials = subs.filter(s => s.is_trial);
    document.getElementById('trial-list').innerHTML = trials.map(t => `
        <div class="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
            <div>
                <p class="font-medium">${t.name}</p>
                <p class="text-sm text-gray-500">试用到期: ${t.trial_end_date || '未知'}</p>
            </div>
            <span class="text-purple-600 text-sm">免费试用中</span>
        </div>
    `).join('') || '<p class="text-gray-500">暂无免费试用</p>';

    loadSharedMembers();
}

async function loadSharedMembers() {
    const allMembers = await fetch(`${API_BASE}/shared-members/`).then(r => r.json());

    document.getElementById('shared-list').innerHTML = allMembers.map(m => `
        <div class="flex items-center justify-between p-3 border rounded-lg">
            <div>
                <p class="font-medium">${m.name}</p>
                <p class="text-sm text-gray-500">${m.subscription_name}</p>
            </div>
            <div class="text-right">
                <p class="font-bold">¥${m.share_amount.toFixed(2)}</p>
                <span class="text-xs ${m.payment_status === 'paid' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'} px-2 py-1 rounded">${m.payment_status === 'paid' ? '已支付' : '待支付'}</span>
            </div>
        </div>
    `).join('') || '<p class="text-gray-500">暂无共享成员</p>';
}

async function makeDecision(id, decision) {
    await fetch(`${API_BASE}/subscriptions/${id}/renewal-decision?decision=${decision}`, { method: 'POST' });
    loadRenewalCountdown();
    loadSubscriptions();
}

async function exportJson() {
    const data = await fetch(`${API_BASE}/export/json`, { method: 'POST' }).then(r => r.json());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subscriptions.json';
    a.click();
}

async function exportCsv() {
    const data = await fetch(`${API_BASE}/export/csv`, { method: 'POST' }).then(r => r.json());
    const blob = new Blob([data.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subscriptions.csv';
    a.click();
}

function importCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e) => {
        const formData = new FormData();
        formData.append('file', e.target.files[0]);
        const data = await fetch(`${API_BASE}/import/csv`, { method: 'POST', body: formData }).then(r => r.json());
        csvCandidates = data.candidates;
        showCsvCandidates();
    };
    input.click();
}

function showCsvCandidates() {
    document.getElementById('csv-candidates-list').innerHTML = csvCandidates.map((c, i) => `
        <label class="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked data-index="${i}" class="csv-candidate-checkbox">
            <div class="flex-1">
                <p class="font-medium">${c.name}</p>
                <p class="text-sm text-gray-500">${c.date || ''}</p>
            </div>
            <span class="font-bold">¥${c.amount}</span>
        </label>
    `).join('') || '<p class="text-gray-500">未发现订阅类扣款</p>';
    openModal('csv-import-panel');
}

async function confirmCsvImport() {
    const checked = Array.from(document.querySelectorAll('.csv-candidate-checkbox:checked'));
    const selected = checked.map(cb => csvCandidates[parseInt(cb.dataset.index)]);
    
    const toCreate = selected.map(c => ({
        name: c.name.substring(0, 50),
        service_type: '其他',
        billing_cycle: 'month',
        price: c.amount,
        notes: `从CSV导入: ${JSON.stringify(c.raw)}`
    }));

    if (toCreate.length) {
        await fetch(`${API_BASE}/subscriptions/batch/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toCreate)
        });
    }

    closeModal('csv-import-panel');
    loadSubscriptions();
    loadDashboard();
    loadAllSubOptions();
    alert(`成功导入 ${toCreate.length} 条订阅记录`);
}

async function loadSharedSubOptions() {
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    document.getElementById('shared-sub-select').innerHTML = subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function openAddSharedMemberModal() {
    openModal('add-shared-member-modal');
}

async function loadCancellationGuides() {
    const guides = await fetch(`${API_BASE}/cancellation-guides/`).then(r => r.json());
    window._guidesData = {};
    guides.forEach(g => {
        window._guidesData[g.subscription_id] = g;
    });
    document.getElementById('cancellation-guides').innerHTML = guides.map(g => `
        <div class="p-4 border rounded-lg">
            <div class="flex justify-between items-start mb-3">
                <h4 class="font-bold">${g.subscription_name}</h4>
                <button onclick="editGuide(${g.subscription_id})" class="text-sm text-indigo-600 hover:underline">编辑</button>
            </div>
            <div class="text-sm space-y-2">
                <div>
                    <p class="text-gray-500 font-medium">取消步骤：</p>
                    <p class="bg-gray-50 p-2 rounded">${g.steps}</p>
                </div>
                ${g.alternative_services ? `<div><p class="text-gray-500 font-medium">替代方案：</p><p class="text-green-600">${g.alternative_services}</p></div>` : ''}
                ${g.notes ? `<div><p class="text-gray-500 font-medium">备注：</p><p>${g.notes}</p></div>` : ''}
            </div>
        </div>
    `).join('') || '<p class="text-gray-500">暂无取消指南</p>';
}

function openEditGuideModal() {
    loadGuideSubOptions();
    openModal('edit-cancellation-guide-modal');
}

async function loadGuideSubOptions() {
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    document.getElementById('guide-sub-select').innerHTML = subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (subs.length) document.getElementById('guide-sub-id').value = subs[0].id;
}

function editGuide(subId) {
    const guide = window._guidesData?.[subId];
    document.getElementById('guide-sub-id').value = subId;
    document.getElementById('guide-sub-select').value = subId;
    if (guide) {
        document.querySelector('#edit-guide-form [name="steps"]').value = guide.steps || '';
        document.querySelector('#edit-guide-form [name="alternative_services"]').value = guide.alternative_services || '';
        document.querySelector('#edit-guide-form [name="notes"]').value = guide.notes || '';
    } else {
        document.querySelector('#edit-guide-form [name="steps"]').value = '';
        document.querySelector('#edit-guide-form [name="alternative_services"]').value = '';
        document.querySelector('#edit-guide-form [name="notes"]').value = '';
    }
    openModal('edit-cancellation-guide-modal');
}

async function compareServices() {
    const type = document.getElementById('compare-type').value;
    const data = await fetch(`${API_BASE}/compare/${type}`).then(r => r.json());
    const cycleText = { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' };
    document.getElementById('compare-table').innerHTML = data.length ? `
        <table class="w-full text-sm">
            <thead><tr class="border-b"><th class="text-left py-2">服务名称</th><th class="text-left py-2">月均价格</th><th class="text-left py-2">原价</th><th class="text-left py-2">周期</th></tr></thead>
            <tbody>${data.map(s => `<tr class="border-b"><td class="py-2">${s.name}</td><td class="py-2 font-bold text-indigo-600">¥${s.monthly_price.toFixed(2)}</td><td class="py-2">¥${s.price}</td><td class="py-2">${cycleText[s.billing_cycle]}</td></tr>`).join('')}</tbody>
        </table>
    ` : '<p class="text-gray-500">暂无该类型的订阅</p>';
}

async function loadSavingTips() {
    const effectiveness = await fetch(`${API_BASE}/cost-effectiveness/`).then(r => r.json());
    const tips = effectiveness.filter(e => e.cost_per_use > 10 && e.usage_count > 0).slice(0, 5).map(e => `
        <div class="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-500">
            <p class="font-medium">💰 ${e.name}</p>
            <p class="text-sm text-gray-600 mt-1">月费 ¥${e.monthly_price.toFixed(2)} 只用了 ${e.usage_count} 次，单次成本 ¥${e.cost_per_use?.toFixed(2)}</p>
            <p class="text-sm text-yellow-700 mt-1">建议：降级套餐或取消订阅</p>
        </div>
    `);
    document.getElementById('saving-tips').innerHTML = tips.join('') || '<p class="text-gray-500">暂无省钱建议，你的订阅使用情况良好！</p>';
}

async function loadArticles() {
    const articles = await fetch(`${API_BASE}/articles/`).then(r => r.json());
    if (articles.length === 0) {
        await Promise.all([
            fetch(`${API_BASE}/articles/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'VPN 哪家好？2024年最新对比', category: '攻略', content: '# VPN 选择指南\n\n## 推荐方案\n\n1. **ExpressVPN** - 速度最快，价格略高\n2. **NordVPN** - 性价比之选，服务器多\n\n## 选择建议\n\n- 只看视频：选便宜的节点\n- 工作需要：选稳定的大厂', is_published: true }) }),
            fetch(`${API_BASE}/articles/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '云存储哪家值？深度横评', category: '攻略', content: '# 云存储横评\n\n## 各大服务对比\n\n| 服务 | 免费空间 | 1T价格 |\n|------|----------|--------|\n| 百度网盘 | 2T | ¥263/年 |\n| 阿里云盘 | 100G | ¥179/年 |', is_published: true }) })
        ]);
        return loadArticles();
    }
    document.getElementById('articles-list').innerHTML = articles.map(a => `
        <div class="p-4 border rounded-lg hover:shadow-md transition cursor-pointer" onclick="viewArticle(${a.id})">
            <div class="flex items-start justify-between">
                <div>
                    <span class="text-xs bg-indigo-100 text-indigo-600 px-2 py-1 rounded">${a.category}</span>
                    <h4 class="font-bold mt-2">${a.title}</h4>
                    <p class="text-sm text-gray-500 mt-1">${new Date(a.created_at).toLocaleDateString()}</p>
                </div>
                <span class="text-gray-400">→</span>
            </div>
        </div>
    `).join('');
}

function viewArticle(id) {
    fetch(`${API_BASE}/articles/${id}`).then(r => r.json()).then(a => alert(`${a.title}\n\n${a.content.substring(0, 300)}...`));
}

async function generateSummary() {
    const year = parseInt(document.getElementById('summary-year').value);
    const data = await fetch(`${API_BASE}/yearly-summary/${year}`).then(r => r.json());
    
    const categories = Object.entries(data.category_breakdown || {});
    
    document.getElementById('summary-content').innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl shadow text-center"><p class="text-gray-500 text-sm">订阅服务数</p><p class="text-3xl font-bold text-indigo-600">${data.total_subscriptions}</p></div>
            <div class="bg-white p-6 rounded-xl shadow text-center"><p class="text-gray-500 text-sm">年度总花费</p><p class="text-3xl font-bold text-green-600">¥${data.total_spent.toFixed(2)}</p></div>
            <div class="bg-white p-6 rounded-xl shadow text-center"><p class="text-gray-500 text-sm">最贵订阅</p><p class="text-lg font-bold text-orange-600">${data.most_expensive_sub?.[0] || '-'}</p></div>
            <div class="bg-white p-6 rounded-xl shadow text-center"><p class="text-gray-500 text-sm">节省潜力</p><p class="text-3xl font-bold text-red-600">¥${data.potential_savings.toFixed(2)}</p></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl shadow"><h3 class="font-bold mb-4">花费类别占比</h3><canvas id="category-pie-chart" height="250"></canvas></div>
            <div class="bg-white p-6 rounded-xl shadow"><h3 class="font-bold mb-4">月度花费</h3><div class="space-y-3">${Object.entries(data.monthly_breakdown || {}).map(([k, v]) => `<div class="flex justify-between"><span>${k}</span><span class="font-bold">¥${v.toFixed(2)}</span></div>`).join('')}</div></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow mb-8">
            <h3 class="font-bold mb-4">📋 新年建议</h3>
            <div class="space-y-3">${data.recommendations.map(r => `<div class="flex items-center justify-between p-3 bg-red-50 rounded-lg"><div><p class="font-medium">${r.name}</p><p class="text-sm text-red-600">${r.action}</p></div><span class="font-bold text-green-600">可省 ¥${r.savings.toFixed(2)}</span></div>`).join('') || '<p class="text-gray-500">所有订阅使用情况良好，继续保持！</p>'}</div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow">
            <h3 class="font-bold mb-4">🏆 年度之最</h3>
            <div class="grid grid-cols-3 gap-6">
                <div class="text-center"><div class="text-4xl mb-2">💎</div><p class="text-sm text-gray-500">使用最多</p><p class="font-bold">${data.most_used_sub?.[0] || '-'}</p><p class="text-sm text-gray-500">${data.most_used_sub?.[1] || 0} 次</p></div>
                <div class="text-center"><div class="text-4xl mb-2">😢</div><p class="text-sm text-gray-500">使用最少</p><p class="font-bold">${data.least_used_sub?.[0] || '-'}</p><p class="text-sm text-gray-500">${data.least_used_sub?.[1] || 0} 次</p></div>
                <div class="text-center"><div class="text-4xl mb-2">💰</div><p class="text-sm text-gray-500">最烧钱</p><p class="font-bold">${data.most_expensive_sub?.[0] || '-'}</p><p class="text-sm text-gray-500">¥${data.most_expensive_sub?.[1]?.toFixed(2) || 0}/月</p></div>
            </div>
        </div>
    `;

    setTimeout(() => {
        if (categoryPieChart) categoryPieChart.destroy();
        const ctx = document.getElementById('category-pie-chart');
        if (ctx && categories.length) {
            categoryPieChart = new Chart(ctx.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: categories.map(c => c[0]),
                    datasets: [{
                        data: categories.map(c => c[1]),
                        backgroundColor: ['#4f46e5', '#22c55e', '#f97316', '#ef4444', '#a855f7', '#ec4899', '#06b6d4', '#84cc16']
                    }]
                },
                options: { responsive: true, plugins: { legend: { position: 'right' } } }
            });
        }
    }, 100);
}

async function loadScreenshots() {
    const subs = await fetch(`${API_BASE}/subscriptions/`).then(r => r.json());
    document.getElementById('screenshot-sub-id').innerHTML = subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    
    const screenshots = await fetch(`${API_BASE}/screenshots/`).then(r => r.json());
    const subMap = Object.fromEntries(subs.map(s => [s.id, s]));
    
    document.getElementById('screenshot-list').innerHTML = screenshots.map(s => `
        <div class="relative group">
            <img src="${s.file_path}" class="w-full h-24 object-cover rounded border">
            <div class="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition rounded flex items-center justify-center gap-2">
                <button onclick="deleteScreenshot(${s.id})" class="text-white text-xs bg-red-600 px-2 py-1 rounded">删除</button>
            </div>
            <p class="text-xs text-gray-500 mt-1 truncate">${subMap[s.subscription_id]?.name || '未知'} · ${s.billing_month}</p>
        </div>
    `).join('') || '';
}

async function uploadScreenshot() {
    const fileInput = document.getElementById('screenshot-upload');
    const file = fileInput.files[0];
    if (!file) { alert('请选择图片文件'); return; }
    
    const subscription_id = parseInt(document.getElementById('screenshot-sub-id').value);
    const billing_month = document.getElementById('screenshot-month').value;
    
    const formData = new FormData();
    formData.append('file', file);
    
    await fetch(`${API_BASE}/screenshots/?subscription_id=${subscription_id}&billing_month=${billing_month}`, {
        method: 'POST',
        body: formData
    });
    
    fileInput.value = '';
    loadScreenshots();
    alert('上传成功');
}

async function deleteScreenshot(id) {
    if (confirm('确定删除此截图？')) {
        await fetch(`${API_BASE}/screenshots/${id}`, { method: 'DELETE' });
        loadScreenshots();
    }
}
