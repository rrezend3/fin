// CONFIGURAÇÕES E ESTADOS GLOBAIS
const STATE = {
  currentDate: new Date(2026, 4, 30), // Inicializado em Maio de 2026
  activeScreen: 'dashboard',
  categories: [],
  creditCards: [],
  transactions: [],
  budgets: [],
  charts: {} // Referências de gráficos para destruição e recriação
};

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// INICIALIZAÇÃO
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // Configura UI do Google Drive e sincronização
  setupSyncIndicator();
  setupGoogleDriveUI();

  if (API.mode === 'drive') {
    if (API.drive.isAuthorized()) {
      try {
        await API.initDriveMode();
      } catch (err) {
        alert('Erro ao carregar banco do Google Drive: ' + err.message);
      }
    } else {
      setTimeout(() => {
        alert('Modo Google Drive ativo, mas a conta não está conectada. Conecte nas configurações.');
        navigateTo('config');
      }, 500);
    }
  }

  lucide.createIcons();
  
  // Carregar dados iniciais (Categorias e Cartões)
  await loadBaseData();
  
  // Registrar listeners de eventos gerais
  registerEventListeners();
  
  // Configurar rotas iniciais
  handleRouting();
  
  // Atualizar cabeçalho e carregar tela ativa
  updateMonthHeader();
  loadCurrentScreenData();

  // Registrar Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker registrado com sucesso:', reg.scope))
      .catch(err => console.error('Erro ao registrar Service Worker:', err));
  }
}

// CARREGAR DADOS BÁSICOS (CATEGORIAS E CARTÕES)
async function loadBaseData() {
  try {
    const [cats, cards] = await Promise.all([
      API.getCategories(),
      API.getCreditCards()
    ]);
    
    STATE.categories = cats;
    STATE.creditCards = cards;
    
    // Popular selects de categorias nos modais
    populateCategorySelects();
    populateCreditCardSelects();
  } catch (err) {
    console.error('Erro ao carregar dados iniciais:', err);
  }
}

// REGISTRAR EVENT LISTENERS
function registerEventListeners() {
  // Navegação da Sidebar
  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('data-target');
      navigateTo(target);
    });
  });

  // Navegação Mobile (Barra Inferior)
  document.querySelectorAll('.bottom-nav a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('data-target');
      navigateTo(target);
    });
  });

  // Botões de navegação de data
  document.getElementById('btn-month-prev').addEventListener('click', () => changeMonth(-1));
  document.getElementById('btn-month-next').addEventListener('click', () => changeMonth(1));
  
  // Abrir seletor de mês manual ao clicar no display
  const display = document.getElementById('month-display');
  const picker = document.getElementById('month-picker');
  display.addEventListener('click', () => {
    picker.value = `${STATE.currentDate.getFullYear()}-${String(STATE.currentDate.getMonth() + 1).padStart(2, '0')}`;
    picker.showPicker();
  });
  picker.addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-');
    STATE.currentDate.setFullYear(parseInt(y));
    STATE.currentDate.setMonth(parseInt(m) - 1);
    updateMonthHeader();
    loadCurrentScreenData();
  });

  // Botões de Abertura de Modais e Menu Suspenso Novo
  const btnNew = document.getElementById('btn-sidebar-new');
  const dropdownNew = document.getElementById('new-trans-dropdown');
  
  if (btnNew && dropdownNew) {
    btnNew.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownNew.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      dropdownNew.classList.remove('active');
    });
    
    document.getElementById('opt-new-expense').addEventListener('click', (e) => {
      e.preventDefault();
      openTransactionModal('expense');
      document.getElementById('trans-payment-method').value = 'money';
      document.getElementById('group-credit-card').style.display = 'none';
      document.getElementById('trans-credit-card').required = false;
    });

    document.getElementById('opt-new-income').addEventListener('click', (e) => {
      e.preventDefault();
      openTransactionModal('income');
    });

    document.getElementById('opt-new-card').addEventListener('click', (e) => {
      e.preventDefault();
      openTransactionModal('expense');
      document.getElementById('trans-payment-method').value = 'credit_card';
      document.getElementById('group-credit-card').style.display = 'block';
      document.getElementById('trans-credit-card').required = true;
    });

    document.getElementById('opt-new-transfer').addEventListener('click', (e) => {
      e.preventDefault();
      alert('Funcionalidade de Transferência entre contas em desenvolvimento!');
    });
  }
  
  const btnExpense = document.getElementById('btn-add-expense');
  if (btnExpense) btnExpense.addEventListener('click', () => openTransactionModal('expense'));
  
  const btnIncome = document.getElementById('btn-add-income');
  if (btnIncome) btnIncome.addEventListener('click', () => openTransactionModal('income'));
  
  const btnCard = document.getElementById('btn-add-card');
  if (btnCard) btnCard.addEventListener('click', () => openModal('modal-card'));
  
  const btnBudget = document.getElementById('btn-define-budget');
  if (btnBudget) btnBudget.addEventListener('click', () => openBudgetModal());

  const btnEmptyBudget = document.getElementById('btn-empty-add-budget');
  if (btnEmptyBudget) btnEmptyBudget.addEventListener('click', () => openBudgetModal());

  // Fechar Modais
  document.getElementById('btn-close-trans-modal').addEventListener('click', () => closeModal('modal-transaction'));
  document.getElementById('btn-cancel-trans-modal').addEventListener('click', () => closeModal('modal-transaction'));
  document.getElementById('btn-close-card-modal').addEventListener('click', () => closeModal('modal-card'));
  document.getElementById('btn-cancel-card-modal').addEventListener('click', () => closeModal('modal-card'));
  document.getElementById('btn-close-budget-modal').addEventListener('click', () => closeModal('modal-budget'));
  document.getElementById('btn-cancel-budget-modal').addEventListener('click', () => closeModal('modal-budget'));
  document.getElementById('btn-close-inst-modal').addEventListener('click', () => closeModal('modal-installment-details'));
  document.getElementById('btn-close-inst-modal-ok').addEventListener('click', () => closeModal('modal-installment-details'));

  // Lógica de categorias dependentes
  document.getElementById('trans-category-main').addEventListener('change', (e) => {
    updateSubcategoriesDropdown(e.target.value);
  });

  // Lógica interna do Modal de Transações
  const selectPayment = document.getElementById('trans-payment-method');
  const groupCard = document.getElementById('group-credit-card');
  const expenseSpecial = document.getElementById('expense-special-fields');
  
  selectPayment.addEventListener('change', (e) => {
    if (e.target.value === 'credit_card') {
      groupCard.style.display = 'block';
      document.getElementById('trans-credit-card').required = true;
    } else {
      groupCard.style.display = 'none';
      document.getElementById('trans-credit-card').required = false;
    }
  });

  // Parcelamento exclui Recorrência e vice-versa
  const checkRecurring = document.getElementById('trans-is-recurring');
  const checkSplit = document.getElementById('trans-is-split');
  const groupInstallments = document.getElementById('group-installments');

  checkRecurring.addEventListener('change', () => {
    if (checkRecurring.checked) {
      checkSplit.checked = false;
      groupInstallments.style.display = 'none';
    }
  });

  checkSplit.addEventListener('change', () => {
    if (checkSplit.checked) {
      checkRecurring.checked = false;
      groupInstallments.style.display = 'block';
    } else {
      groupInstallments.style.display = 'none';
    }
  });

  // Submissão de Formulários
  document.getElementById('form-transaction').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('form-card').addEventListener('submit', handleCardSubmit);
  document.getElementById('form-budget').addEventListener('submit', handleBudgetSubmit);
  document.getElementById('form-add-category').addEventListener('submit', handleCategorySubmit);

  // Filtros de Transações
  document.getElementById('filter-search').addEventListener('input', renderTransactionsScreen);
  document.getElementById('filter-type').addEventListener('change', renderTransactionsScreen);
  document.getElementById('filter-status').addEventListener('change', renderTransactionsScreen);

  // Abas de Relatórios
  document.querySelectorAll('.report-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabTarget = tab.getAttribute('data-tab');
      document.querySelectorAll('.report-tab-content').forEach(c => c.style.display = 'none');
      document.getElementById(`report-tab-${tabTarget}`).style.display = 'block';
      
      if (tabTarget === 'annual-summary') {
        loadAnnualReport();
      } else if (tabTarget === 'monthly-report') {
        loadMonthlyReport();
      }
    });
  });

  document.getElementById('report-year-select').addEventListener('change', () => {
    if (document.querySelector('.report-tab[data-tab="annual-summary"]').classList.contains('active')) {
      loadAnnualReport();
    }
  });

  document.getElementById('report-monthly-type').addEventListener('change', () => {
    if (document.querySelector('.report-tab[data-tab="monthly-report"]').classList.contains('active')) {
      loadMonthlyReport();
    }
  });

  // Detalhes do Cartão de Crédito
  document.getElementById('btn-back-to-cards').addEventListener('click', () => {
    navigateTo('cards');
  });

  document.getElementById('btn-edit-current-card').addEventListener('click', () => {
    openEditCardModal();
  });

  document.getElementById('btn-close-edit-card-modal').addEventListener('click', () => {
    closeModal('modal-edit-card');
  });

  document.getElementById('btn-cancel-edit-card-modal').addEventListener('click', () => {
    closeModal('modal-edit-card');
  });

  document.getElementById('btn-card-month-prev').addEventListener('click', () => {
    changeCardMonth(-1);
  });

  document.getElementById('btn-card-month-next').addEventListener('click', () => {
    changeCardMonth(1);
  });

  document.getElementById('form-edit-card').addEventListener('submit', handleEditCardSubmit);

  document.getElementById('btn-pay-card-bill').addEventListener('click', () => {
    handlePayCardBill();
  });
}

// SPA ROUTING
function handleRouting() {
  const hash = window.location.hash.substring(1);
  if (['dashboard', 'transactions', 'cards', 'planning', 'reports', 'config'].includes(hash)) {
    navigateTo(hash, false);
  } else {
    navigateTo('dashboard', false);
  }
}

function navigateTo(screenId, updateHash = true) {
  STATE.activeScreen = screenId;
  
  // Atualizar classe ativa na barra lateral
  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    if (link.getAttribute('data-target') === screenId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Atualizar classe ativa na barra inferior móvel
  document.querySelectorAll('.bottom-nav a').forEach(link => {
    if (link.getAttribute('data-target') === screenId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Mostrar a tela correspondente
  document.querySelectorAll('.app-screen').forEach(screen => {
    screen.style.display = 'none';
  });
  
  const targetScreen = document.getElementById(`screen-${screenId}`);
  if (targetScreen) targetScreen.style.display = 'block';

  if (updateHash) {
    window.location.hash = screenId;
  }

  // Carregar dados da tela ativa
  loadCurrentScreenData();
}

// GERENCIAMENTO DE MESES
function changeMonth(delta) {
  STATE.currentDate.setMonth(STATE.currentDate.getMonth() + delta);
  updateMonthHeader();
  loadCurrentScreenData();
}

function updateMonthHeader() {
  const monthName = MONTH_NAMES[STATE.currentDate.getMonth()];
  const year = STATE.currentDate.getFullYear();
  document.getElementById('month-display').textContent = `${monthName} ${year}`;
}

// FORMATADORES
function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateStr) {
  // data em YYYY-MM-DD convertida para DD/MM/YYYY localmente
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// RETORNAR MÊS ATUAL NO FORMATO YYYY-MM
function getYearMonthString() {
  const y = STATE.currentDate.getFullYear();
  const m = String(STATE.currentDate.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// CARREGAR DADOS DA TELA ATUAL
function loadCurrentScreenData() {
  const month = getYearMonthString();
  
  switch (STATE.activeScreen) {
    case 'dashboard':
      loadDashboardData(month);
      break;
    case 'transactions':
      loadTransactionsData(month);
      break;
    case 'cards':
      loadCardsData();
      break;
    case 'card-detail':
      loadCardDetailData();
      break;
    case 'planning':
      loadPlanningData(month);
      break;
    case 'reports':
      // Se aba ativa for de resumo anual, carrega
      if (document.querySelector('.report-tab[data-tab="annual-summary"]').classList.contains('active')) {
        loadAnnualReport();
      } else {
        loadMonthlyReport();
      }
      break;
    case 'config':
      renderConfigScreen();
      break;
  }
}

// 1. LÓGICA DA TELA DASHBOARD
async function loadDashboardData(month) {
  try {
    const data = await API.getDashboard(month);
    
    // Atualizar Cards de Resumo
    document.getElementById('dash-real-balance').textContent = formatCurrency(data.totals.balanceRealized);
    
    document.getElementById('dash-total-income').textContent = formatCurrency(data.totals.totalIncome);
    document.getElementById('dash-income-sub').textContent = `Efetivado: ${formatCurrency(data.totals.realizedIncome)}`;
    
    document.getElementById('dash-total-expense').textContent = formatCurrency(data.totals.totalExpense);
    document.getElementById('dash-expense-sub').textContent = `Efetivado: ${formatCurrency(data.totals.realizedExpense)}`;
    
    document.getElementById('dash-credit-card').textContent = formatCurrency(data.totals.creditCardTotal);
    
    // Balanço previsto e progresso
    const predictedBalanceEl = document.getElementById('dash-predicted-balance');
    predictedBalanceEl.textContent = formatCurrency(data.totals.balanceProjected);
    if (data.totals.balanceProjected < 0) {
      predictedBalanceEl.className = 'value-negative';
      document.getElementById('dash-balance-badge').textContent = 'Atenção';
      document.getElementById('dash-balance-badge').style.backgroundColor = 'var(--danger-light)';
      document.getElementById('dash-balance-badge').style.color = 'var(--danger-text)';
    } else {
      predictedBalanceEl.className = 'value-positive';
      document.getElementById('dash-balance-badge').textContent = 'Estável';
      document.getElementById('dash-balance-badge').style.backgroundColor = 'var(--success-light)';
      document.getElementById('dash-balance-badge').style.color = 'var(--success-text)';
    }

    // Progresso de renda comprometida
    let commitmentPercent = 0;
    if (data.totals.totalIncome > 0) {
      commitmentPercent = Math.min(100, Math.round((data.totals.totalExpense / data.totals.totalIncome) * 100));
    } else if (data.totals.totalExpense > 0) {
      commitmentPercent = 100;
    }
    
    document.getElementById('dash-income-commitment-bar').style.width = `${commitmentPercent}%`;
    document.getElementById('dash-commitment-sub').textContent = `${commitmentPercent}% das receitas previstas serão gastas.`;
    
    // Renderizar Gráfico de Categoria
    renderDashboardExpensesChart(data.categoryExpenses);

    // Carregar transações pendentes rápidas
    loadPendingTransactionsList(month);

  } catch (err) {
    console.error('Erro ao carregar dados do Dashboard:', err);
  }
}

function renderDashboardExpensesChart(categoryData) {
  const ctx = document.getElementById('chartExpenses').getContext('2d');
  
  if (STATE.charts.dashExpenses) {
    STATE.charts.dashExpenses.destroy();
  }

  const noDataEl = document.getElementById('chart-no-data');
  const canvasEl = document.getElementById('chartExpenses');
  
  if (!categoryData || categoryData.length === 0) {
    noDataEl.style.display = 'flex';
    canvasEl.style.display = 'none';
    return;
  }
  
  noDataEl.style.display = 'none';
  canvasEl.style.display = 'block';

  // Cores dinâmicas para gráfico
  const colors = [
    '#5e17eb', '#00bfa5', '#ff9100', '#d32f2f', '#1976d2',
    '#9c27b0', '#e91e63', '#4caf50', '#ffeb3b', '#795548'
  ];

  STATE.charts.dashExpenses = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: categoryData.map(c => c.name),
      datasets: [{
        data: categoryData.map(c => c.value),
        backgroundColor: categoryData.map((_, i) => colors[i % colors.length]),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { family: 'Outfit', size: 12 },
            boxWidth: 12
          }
        }
      },
      cutout: '65%'
    }
  });
}

async function loadPendingTransactionsList(month) {
  try {
    const transactions = await API.getTransactions(month);
    
    const pendingList = document.getElementById('dash-pending-list');
    pendingList.innerHTML = '';
    
    const pendings = transactions.filter(t => t.status === 'pending');
    
    if (pendings.length === 0) {
      pendingList.innerHTML = '<p class="text-muted" style="font-size: 13px; text-align: center; padding: 12px 0;">Nenhuma conta pendente para este mês.</p>';
      return;
    }
    
    // Mostrar no máximo 5 itens pendentes no dashboard
    pendings.slice(0, 5).forEach(t => {
      const item = document.createElement('div');
      item.className = 'bill-breakdown-item';
      item.style.marginBottom = '8px';
      
      const isIncome = t.type === 'income';
      const colorClass = isIncome ? 'value-positive' : 'value-negative';
      const prefix = isIncome ? '+' : '-';
      const statusLabel = t.is_projected ? 'Previsto (Recorrente)' : 'Previsto';

      item.innerHTML = `
        <div>
          <span class="bill-card-name" style="display: flex; align-items: center; gap: 8px;">
            ${t.description || t.category_name || 'Sem descrição'}
            <span class="badge-status pending" style="padding: 2px 6px; font-size: 9px;">${statusLabel}</span>
          </span>
          <span class="bill-card-dates">${formatDate(t.date)} | ${t.category_name || 'Geral'}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <span class="${colorClass}" style="font-weight: 700;">${prefix} ${formatCurrency(t.amount)}</span>
          <button class="btn-action commit" title="Efetivar" onclick="realizeTransaction('${t.id}', ${t.recurrence_id || 'null'}, '${t.date}')">
            <i data-lucide="check"></i>
          </button>
        </div>
      `;
      pendingList.appendChild(item);
    });
    
    lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar lista de pendentes:', err);
  }
}

// 2. LÓGICA DA TELA TRANSAÇÕES
async function loadTransactionsData(month) {
  try {
    STATE.transactions = await API.getTransactions(month);
    renderTransactionsScreen();
  } catch (err) {
    console.error('Erro ao buscar transações:', err);
  }
}

function renderTransactionsScreen() {
  const tbody = document.getElementById('transactions-table-body');
  const emptyState = document.getElementById('transactions-empty-state');
  tbody.innerHTML = '';
  
  // Obter filtros
  const searchQuery = document.getElementById('filter-search').value.toLowerCase().trim();
  const filterType = document.getElementById('filter-type').value;
  const filterStatus = document.getElementById('filter-status').value;

  const filtered = STATE.transactions.filter(t => {
    const descLower = (t.description || '').toLowerCase();
    const matchesSearch = descLower.includes(searchQuery) || 
                          (t.category_name && t.category_name.toLowerCase().includes(searchQuery));
    const matchesType = filterType === 'all' || t.type === filterType;
    const matchesStatus = filterStatus === 'all' || t.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    document.querySelector('.transactions-table').style.display = 'none';
    return;
  }
  
  emptyState.style.display = 'none';
  document.querySelector('.transactions-table').style.display = 'table';

  filtered.forEach(t => {
    const tr = document.createElement('tr');
    
    const isIncome = t.type === 'income';
    const amountVal = isIncome ? t.amount : -t.amount;
    const colorClass = isIncome ? 'value-positive' : 'value-negative';
    
    const statusText = t.status === 'realized' ? 'Pago' : 'Pendente';
    const statusClass = t.status === 'realized' ? 'realized' : 'pending';
    
    let methodText = 'Dinheiro/Débito';
    if (t.payment_method === 'credit_card') {
      methodText = `💳 ${t.credit_card_name || 'Cartão'}`;
    }

    // Ações
    let actionsHtml = '';
    if (t.status === 'pending') {
      actionsHtml += `
        <button class="btn-action commit" title="Efetivar lançamento" onclick="realizeTransaction('${t.id}', ${t.recurrence_id || 'null'}, '${t.date}')">
          <i data-lucide="check"></i>
        </button>
      `;
    }
    
    if (t.is_projected) {
      actionsHtml += `
        <button class="btn-action edit" title="Editar recorrência" onclick="editTransaction('${t.id}')" style="color: var(--primary); background-color: var(--primary-light); margin-right: 4px;">
          <i data-lucide="pencil"></i>
        </button>
        <button class="btn-action delete" title="Excluir recorrência" onclick="deleteRecurrence('${t.recurrence_id}', '${t.date}')">
          <i data-lucide="trash-2"></i>
        </button>
      `;
    } else {
      actionsHtml += `
        <button class="btn-action edit" title="Editar lançamento" onclick="editTransaction('${t.id}')" style="color: var(--primary); background-color: var(--primary-light); margin-right: 4px;">
          <i data-lucide="pencil"></i>
        </button>
        <button class="btn-action delete" title="Excluir lançamento" onclick="deleteTransaction('${t.id}')">
          <i data-lucide="trash-2"></i>
        </button>
      `;
    }

    if (t.installment_group_id) {
      actionsHtml += `
        <button class="btn-action edit" title="Ver detalhes do parcelamento" onclick="showInstallmentDetails('${t.installment_group_id}')" style="color: var(--primary); background-color: var(--primary-light); margin-right: 4px;">
          <i data-lucide="info"></i>
        </button>
      `;
    }

    tr.innerHTML = `
      <td>${formatDate(t.date)}</td>
      <td>
        <span style="font-weight: 600;">${t.description || t.category_name || 'Sem descrição'}</span>
        ${t.installment_number ? `<br><span class="badge-status pending" style="cursor: pointer; margin-top: 4px; font-size: 10px; background-color: var(--primary-light); color: var(--primary); display: inline-flex; align-items: center; gap: 4px;" onclick="showInstallmentDetails('${t.installment_group_id}')"><i data-lucide="info" style="width: 10px; height: 10px;"></i>Parcela ${t.installment_number}/${t.installments_total}</span>` : ''}
      </td>
      <td>
        ${t.category_parent ? `<small class="text-muted" style="display:block;">${t.category_parent}</small>` : ''}
        <span>${t.category_name || 'Geral'}</span>
      </td>
      <td>${methodText}</td>
      <td class="${colorClass}" style="font-weight:700;">${formatCurrency(amountVal)}</td>
      <td>
        <span class="badge-status ${statusClass}">${statusText}</span>
      </td>
      <td>
        <div class="actions-cell">
          ${actionsHtml}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  lucide.createIcons();
}

// EFETIVAR TRANSAÇÃO (Física ou Projetada)
async function realizeTransaction(id, recurrenceId, date) {
  try {
    let payload = {};
    if (id && !String(id).startsWith('rec-')) {
      payload = { id: parseInt(id) };
    } else if (recurrenceId && date) {
      payload = { recurrence_id: parseInt(recurrenceId), date: date };
    } else {
      return;
    }

    const result = await API.realizeTransaction(payload);
    if (result && result.success) {
      // Recarregar dados
      loadCurrentScreenData();
      // Atualiza também os totais da dashboard caso estejamos lá
      if (STATE.activeScreen !== 'dashboard') {
        loadDashboardData(getYearMonthString());
      }
    } else {
      alert('Erro ao efetivar transação: ' + result.error);
    }
  } catch (err) {
    console.error('Erro ao efetivar transação:', err);
  }
}

// DELETAR TRANSAÇÃO FÍSICA
async function deleteTransaction(id) {
  const trans = STATE.transactions.find(t => t.id === parseInt(id));
  if (trans && trans.recurrence_id) {
    const choice = confirm("Este lançamento faz parte de uma recorrência.\n\nClique em OK para excluir apenas este mês.\nClique em Cancelar para gerenciar a exclusão da recorrência inteira.");
    if (choice) {
      // Excluir apenas este mês
      try {
        const result = await API.deleteTransaction(id);
        if (result && result.success) {
          loadCurrentScreenData();
          if (STATE.activeScreen !== 'dashboard') {
            loadDashboardData(getYearMonthString());
          }
        } else {
          alert('Erro ao deletar transação: ' + result.error);
        }
      } catch (err) {
        console.error('Erro ao deletar transação:', err);
      }
    } else {
      // Chamar deleteRecurrence para dar opções de exclusão da recorrência
      deleteRecurrence(trans.recurrence_id, trans.date);
    }
    return;
  }

  if (!confirm('Deseja realmente excluir este lançamento?')) return;
  
  try {
    const result = await API.deleteTransaction(id);
    if (result && result.success) {
      loadCurrentScreenData();
      if (STATE.activeScreen !== 'dashboard') {
        loadDashboardData(getYearMonthString());
      }
    } else {
      alert('Erro ao deletar transação: ' + result.error);
    }
  } catch (err) {
    console.error('Erro ao deletar transação:', err);
  }
}

async function deleteRecurrence(recurrenceId, date) {
  const month = date.substring(0, 7);
  if (!confirm("Deseja realmente remover esta despesa/receita recorrente?")) return;

  const stopOnly = confirm(
    "Deseja PARAR a recorrência a partir deste mês (" + month + "), mantendo o histórico dos meses anteriores?\n\n" +
    "Clique em OK para preservar o histórico.\n" +
    "Clique em Cancelar para excluir a recorrência inteira (afetando todos os meses)."
  );

  let url = `/api/recurrences?id=${recurrenceId}`;
  if (stopOnly) {
    url += `&month=${month}`;
  } else {
    if (!confirm("AVISO: Isso irá remover o vínculo desta recorrência em todos os meses passados e futuros. Deseja continuar?")) {
      return;
    }
  }

  try {
    const result = await API.deleteRecurrence(recurrenceId, stopOnly ? month : null);
    if (result && !result.error) {
      loadCurrentScreenData();
      if (STATE.activeScreen !== 'dashboard') {
        loadDashboardData(getYearMonthString());
      }
    } else {
      alert("Erro ao excluir recorrência: " + (result ? result.error : 'Erro desconhecido'));
    }
  } catch (err) {
    console.error("Erro na exclusão da recorrência:", err);
  }
}

// 3. LÓGICA DA TELA CARTÕES
async function loadCardsData() {
  try {
    STATE.creditCards = await API.getCreditCards();
    
    // Obter faturas de cartão do mês
    const month = getYearMonthString();
    const dashData = await API.getDashboard(month);

    renderCardsScreen(dashData.totals.creditCardTotal);
  } catch (err) {
    console.error('Erro ao carregar cartões de crédito:', err);
  }
}

async function renderCardsScreen(totalBills) {
  const cardsContainer = document.getElementById('cards-list-container');
  const breakdownContainer = document.getElementById('card-bill-breakdown');
  
  cardsContainer.innerHTML = '';
  breakdownContainer.innerHTML = '';
  
  document.getElementById('card-total-bills-value').textContent = formatCurrency(totalBills);

  if (STATE.creditCards.length === 0) {
    cardsContainer.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <i data-lucide="credit-card"></i>
        <p>Nenhum cartão de crédito cadastrado.</p>
      </div>
    `;
    return;
  }

  // Buscar detalhes de transações para calcular faturas individuais no mês selecionado
  const month = getYearMonthString();
  const transactions = await API.getTransactions(month);

  STATE.creditCards.forEach(card => {
    // Calcular total gasto neste cartão específico com fatura em 'month'
    const cardTrans = transactions.filter(t => t.payment_method === 'credit_card' && t.credit_card_id === card.id);
    const spentInMonth = cardTrans.reduce((sum, t) => sum + t.amount, 0.0);
    
    // Renderizar Cartão Físico UI
    const cardEl = document.createElement('div');
    cardEl.className = 'credit-card-ui';
    cardEl.style.cursor = 'pointer';
    cardEl.addEventListener('click', () => {
      openCardDetails(card.id);
    });
    
    const availableLimit = card.credit_limit - spentInMonth;
    
    cardEl.innerHTML = `
      <div class="card-ui-header">
        <span class="card-ui-bank">${card.name}</span>
        <span class="card-ui-type">Crédito</span>
      </div>
      <div class="card-ui-limit-box">
        <span style="font-size: 11px; opacity: 0.7;">Fatura deste mês</span>
        <div class="card-ui-spent">${formatCurrency(spentInMonth)}</div>
        <div class="card-ui-limit-text">Limite Disponível: ${formatCurrency(availableLimit)} / ${formatCurrency(card.credit_limit)}</div>
      </div>
    `;
    cardsContainer.appendChild(cardEl);

    // Adicionar ao painel de faturas à direita
    const breakdownEl = document.createElement('div');
    breakdownEl.className = 'bill-breakdown-item';
    breakdownEl.style.cursor = 'pointer';
    breakdownEl.addEventListener('click', () => {
      openCardDetails(card.id);
    });
    breakdownEl.innerHTML = `
      <div>
        <span class="bill-card-name">${card.name}</span>
        <span class="bill-card-dates">Fechamento: dia ${card.closing_day} | Vence: dia ${card.due_day}</span>
      </div>
      <span class="bill-card-amount">${formatCurrency(spentInMonth)}</span>
    `;
    breakdownContainer.appendChild(breakdownEl);
  });

  lucide.createIcons();
}

// 4. LÓGICA DA TELA PLANEJAMENTO (ORÇAMENTOS)
async function loadPlanningData(month) {
  try {
    const [budgets, dashData] = await Promise.all([
      API.getBudgets(month),
      API.getDashboard(month)
    ]);

    STATE.budgets = budgets;
    
    renderPlanningScreen(budgets, dashData);
  } catch (err) {
    console.error('Erro ao carregar dados de planejamento:', err);
  }
}

function renderPlanningScreen(budgets, dashData) {
  // Totais resumidos do topo
  const totalIncome = dashData.totals.totalIncome;
  const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0.0);
  const totalSpent = dashData.totals.totalExpense;

  document.getElementById('plan-income-val').textContent = formatCurrency(totalIncome);
  document.getElementById('plan-budgeted-val').textContent = formatCurrency(totalBudgeted);
  document.getElementById('plan-balance-val').textContent = formatCurrency(totalIncome - totalBudgeted);
  document.getElementById('plan-spent-val').textContent = formatCurrency(totalSpent);

  const container = document.getElementById('planning-budget-list');
  const emptyState = document.getElementById('planning-empty-state');
  container.innerHTML = '';

  if (budgets.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  
  emptyState.style.display = 'none';

  budgets.forEach(b => {
    // Descobrir quanto foi gasto nesta categoria específica na dashboard
    // Gasto inclui despesas normais e de cartão no mês
    const catExpenseObj = dashData.categoryExpenses.find(c => c.name === b.category_name || c.name === b.category_parent);
    const spent = catExpenseObj ? catExpenseObj.value : 0.0;
    
    let percent = 0;
    if (b.amount > 0) {
      percent = Math.min(100, Math.round((spent / b.amount) * 100));
    }
    
    let barColorClass = 'normal';
    if (percent >= 100) {
      barColorClass = 'danger';
    } else if (percent >= 85) {
      barColorClass = 'warning';
    }

    const item = document.createElement('div');
    item.className = 'budget-item';
    
    const recurringBadge = b.is_recurring 
      ? `<span class="badge-status realized" style="padding: 2px 6px; font-size: 10px; margin-left: 8px; background-color: var(--primary-light); color: var(--primary); display: inline-flex; align-items: center; gap: 4px; vertical-align: middle;"><i data-lucide="refresh-cw" style="width: 10px; height: 10px;"></i>Recorrente</span>`
      : '';

    item.innerHTML = `
      <div class="budget-item-header">
        <span>${b.category_name} ${b.category_parent ? `<small class="text-muted">(${b.category_parent})</small>` : ''}${recurringBadge}</span>
        <span>${formatCurrency(spent)} / ${formatCurrency(b.amount)}</span>
      </div>
      <div class="budget-bar-bg">
        <div class="budget-bar-fill ${barColorClass}" style="width: ${percent}%;"></div>
      </div>
      <div class="budget-spent-info">
        <span>${percent}% do limite consumido. Restante: ${formatCurrency(Math.max(0, b.amount - spent))}</span>
      </div>
    `;
    container.appendChild(item);
  });
  
  lucide.createIcons();
}

// 5. LÓGICA DE RELATÓRIOS (ANO MÊS A MÊS)
async function loadAnnualReport() {
  try {
    // Garantir que o seletor de ano esteja visível
    document.getElementById('report-year-selector-container').style.display = 'block';
    
    const year = document.getElementById('report-year-select').value;
    const data = await API.getAnnualReport(year);
    
    const tbody = document.getElementById('report-annual-table-body');
    tbody.innerHTML = '';

    let sumRealizedIncome = 0;
    let sumPendingIncome = 0;
    let sumRealizedExpense = 0;
    let sumPendingExpense = 0;

    data.forEach(row => {
      const tr = document.createElement('tr');
      
      const monthIndex = parseInt(row.month.split('-')[1]) - 1;
      const monthLabel = MONTH_NAMES[monthIndex];

      sumRealizedIncome += row.realizedIncome;
      sumPendingIncome += row.pendingIncome;
      sumRealizedExpense += row.realizedExpense;
      sumPendingExpense += row.pendingExpense;

      tr.innerHTML = `
        <td style="font-weight: 600;">${monthLabel}</td>
        <td class="value-positive">${formatCurrency(row.realizedIncome)}</td>
        <td class="text-muted">${formatCurrency(row.pendingIncome)}</td>
        <td class="value-negative">${formatCurrency(row.realizedExpense)}</td>
        <td class="text-muted">${formatCurrency(row.pendingExpense)}</td>
        <td class="${row.balanceRealized >= 0 ? 'value-positive' : 'value-negative'}" style="font-weight: 600;">
          ${formatCurrency(row.balanceRealized)}
        </td>
        <td class="${row.balanceTotal >= 0 ? 'value-positive' : 'value-negative'}" style="font-weight: 700;">
          ${formatCurrency(row.balanceTotal)}
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Adiciona Linha de Totais Consolidados
    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    
    const totalRealizedBalance = sumRealizedIncome - sumRealizedExpense;
    const totalPredictedBalance = (sumRealizedIncome + sumPendingIncome) - (sumRealizedExpense + sumPendingExpense);

    totalRow.innerHTML = `
      <td>TOTAL</td>
      <td class="value-positive">${formatCurrency(sumRealizedIncome)}</td>
      <td class="text-muted">${formatCurrency(sumPendingIncome)}</td>
      <td class="value-negative">${formatCurrency(sumRealizedExpense)}</td>
      <td class="text-muted">${formatCurrency(sumPendingExpense)}</td>
      <td class="${totalRealizedBalance >= 0 ? 'value-positive' : 'value-negative'}">${formatCurrency(totalRealizedBalance)}</td>
      <td class="${totalPredictedBalance >= 0 ? 'value-positive' : 'value-negative'}">${formatCurrency(totalPredictedBalance)}</td>
    `;
    tbody.appendChild(totalRow);

  } catch (err) {
    console.error('Erro ao gerar relatório anual:', err);
  }
}

async function renderReportsCategoryChart() {
  const month = getYearMonthString();
  try {
    const data = await API.getDashboard(month);
    
    const ctx = document.getElementById('chartReportsCategoryExpenses').getContext('2d');
    
    if (STATE.charts.reportsExpenses) {
      STATE.charts.reportsExpenses.destroy();
    }

    const categoryData = data.categoryExpenses;
    
    if (!categoryData || categoryData.length === 0) {
      // Desenha aviso vazio
      return;
    }

    const colors = [
      '#5e17eb', '#00bfa5', '#ff9100', '#d32f2f', '#1976d2',
      '#9c27b0', '#e91e63', '#4caf50', '#ffeb3b', '#795548'
    ];

    STATE.charts.reportsExpenses = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: categoryData.map(c => c.name),
        datasets: [{
          label: 'Valor Gasto (R$)',
          data: categoryData.map(c => c.value),
          backgroundColor: colors.slice(0, categoryData.length),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: { family: 'Outfit' } }
          },
          x: {
            ticks: { font: { family: 'Outfit' } }
          }
        }
      }
    });

  } catch (err) {
    console.error('Erro ao renderizar gráfico amplo de relatórios:', err);
  }
}

// 6. TELA CONFIGURAÇÕES
function renderConfigScreen() {
  const container = document.getElementById('config-categories-container');
  container.innerHTML = '';

  if (STATE.categories.length === 0) {
    container.innerHTML = '<p class="text-muted">Nenhuma categoria cadastrada.</p>';
    return;
  }

  const mainCats = STATE.categories.filter(c => !c.parent);
  const subCats = STATE.categories.filter(c => c.parent);

  const mainHeader = document.createElement('h4');
  mainHeader.textContent = 'Categorias Principais';
  mainHeader.style.margin = '12px 0 8px 0';
  mainHeader.style.color = 'var(--primary)';
  mainHeader.style.fontSize = '14px';
  mainHeader.style.borderBottom = '1px dashed var(--border-color)';
  mainHeader.style.paddingBottom = '4px';
  container.appendChild(mainHeader);

  mainCats.forEach(cat => {
    const item = renderConfigCatItem(cat);
    container.appendChild(item);
  });

  const subHeader = document.createElement('h4');
  subHeader.textContent = 'Subcategorias';
  subHeader.style.margin = '20px 0 8px 0';
  subHeader.style.color = 'var(--secondary)';
  subHeader.style.fontSize = '14px';
  subHeader.style.borderBottom = '1px dashed var(--border-color)';
  subHeader.style.paddingBottom = '4px';
  container.appendChild(subHeader);

  subCats.forEach(cat => {
    const item = renderConfigCatItem(cat);
    container.appendChild(item);
  });
}

function renderConfigCatItem(cat) {
  const item = document.createElement('div');
  item.className = 'config-cat-item';
  item.style.marginBottom = '6px';
  
  const badgeType = cat.type === 'expense' ? 'Despesa' : 'Receita';
  const typeClass = cat.type;

  item.innerHTML = `
    <div>
      <span class="config-cat-name">${cat.name}</span>
      ${cat.parent ? `<span class="config-cat-parent">${cat.parent}</span>` : ''}
      ${cat.description ? `<br><small class="text-muted">${cat.description}</small>` : ''}
    </div>
    <span class="config-cat-type ${typeClass}">${badgeType}</span>
  `;
  return item;
}

// ================= MODAIS & SUBMISSÕES =================

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Modal de Lançamentos
function openTransactionModal(type = 'expense') {
  document.getElementById('trans-type').value = type;
  document.getElementById('modal-trans-title').textContent = type === 'expense' ? 'Nova Despesa' : 'Nova Receita';
  
  // Setar data padrão como hoje (ano/mes corrente, mantendo o dia)
  const today = new Date();
  const defaultDate = `${STATE.currentDate.getFullYear()}-${String(STATE.currentDate.getMonth() + 1).padStart(2, '0')}-${String(Math.min(today.getDate(), 28)).padStart(2, '0')}`;
  document.getElementById('trans-date').value = defaultDate;

  // Filtrar categorias do select de acordo com o tipo
  filterCategoriesSelect(type);

  // Limpar campos
  document.getElementById('trans-id').value = '';
  document.getElementById('trans-amount').value = '';
  document.getElementById('trans-desc').value = '';
  document.getElementById('trans-payment-method').value = 'money';
  document.getElementById('group-credit-card').style.display = 'none';
  document.getElementById('trans-credit-card').required = false;
  document.getElementById('trans-recurrence-id').value = '';
  document.getElementById('trans-recurrence-month').value = '';
  document.getElementById('group-recurrence-edit-scope').style.display = 'none';

  // Configurar campos extras
  const recFields = document.getElementById('recurrence-special-fields');
  const splitFields = document.getElementById('split-special-fields');
  
  recFields.style.display = 'block';
  if (type === 'expense') {
    splitFields.style.display = 'block';
  } else {
    splitFields.style.display = 'none';
  }
  
  document.getElementById('trans-is-recurring').checked = false;
  document.getElementById('trans-is-split').checked = false;
  document.getElementById('group-installments').style.display = 'none';
  document.getElementById('trans-status').value = 'realized';

  openModal('modal-transaction');
}

function filterCategoriesSelect(type) {
  const selectMain = document.getElementById('trans-category-main');
  selectMain.innerHTML = '';
  
  const mainCategories = STATE.categories.filter(c => c.type === type && !c.parent);
  
  const optDefault = document.createElement('option');
  optDefault.value = '';
  optDefault.textContent = 'Selecione uma categoria...';
  optDefault.disabled = true;
  optDefault.selected = true;
  selectMain.appendChild(optDefault);
  
  mainCategories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    selectMain.appendChild(opt);
  });
  
  // Limpar e ocultar subcategorias
  const selectSub = document.getElementById('trans-category-sub');
  selectSub.innerHTML = '';
  document.getElementById('group-category-sub').style.display = 'none';
}

function updateSubcategoriesDropdown(mainCategoryId) {
  const selectSub = document.getElementById('trans-category-sub');
  selectSub.innerHTML = '';
  
  if (!mainCategoryId) {
    document.getElementById('group-category-sub').style.display = 'none';
    return;
  }
  
  const mainCat = STATE.categories.find(c => c.id === parseInt(mainCategoryId));
  if (!mainCat) {
    document.getElementById('group-category-sub').style.display = 'none';
    return;
  }
  
  const subCategories = STATE.categories.filter(c => c.parent === mainCat.name && c.type === mainCat.type);
  
  if (subCategories.length === 0) {
    document.getElementById('group-category-sub').style.display = 'none';
    return;
  }
  
  document.getElementById('group-category-sub').style.display = 'block';
  
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = 'Nenhuma (Apenas Categoria Principal)';
  selectSub.appendChild(optNone);
  
  subCategories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    selectSub.appendChild(opt);
  });
}

function populateCategorySelects() {
  // Select do modal de orçamentos (só despesas)
  const select = document.getElementById('budget-category');
  select.innerHTML = '';
  
  const expenses = STATE.categories.filter(c => c.type === 'expense');
  expenses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.parent ? `${c.parent} > ${c.name}` : c.name;
    select.appendChild(opt);
  });
}

function populateCreditCardSelects() {
  const select = document.getElementById('trans-credit-card');
  select.innerHTML = '';
  
  if (STATE.creditCards.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Nenhum cartão cadastrado';
    select.appendChild(opt);
    return;
  }

  STATE.creditCards.forEach(card => {
    const opt = document.createElement('option');
    opt.value = card.id;
    opt.textContent = `${card.name} (Lim. R$ ${card.credit_limit})`;
    select.appendChild(opt);
  });
}

function openBudgetModal() {
  if (STATE.categories.length === 0) {
    alert('Cadastre categorias de despesa primeiro.');
    return;
  }
  document.getElementById('budget-amount').value = '';
  document.getElementById('budget-is-recurring').checked = false;
  openModal('modal-budget');
}

// SUBMISSAO TRANSAÇÃO (NOVA OU EDICAO)
async function handleTransactionSubmit(e) {
  e.preventDefault();
  
  const idStr = document.getElementById('trans-id').value;
  const id = idStr ? parseInt(idStr) : null;
  
  const amount = parseFloat(document.getElementById('trans-amount').value);
  const type = document.getElementById('trans-type').value;
  const description = document.getElementById('trans-desc').value;
  const date = document.getElementById('trans-date').value;
  const mainCategoryIdStr = document.getElementById('trans-category-main').value;
  const mainCategoryId = mainCategoryIdStr ? parseInt(mainCategoryIdStr) : null;
  const subCategoryIdStr = document.getElementById('trans-category-sub').value;
  const subCategoryId = subCategoryIdStr ? parseInt(subCategoryIdStr) : null;
  
  const category_id = subCategoryId || mainCategoryId;
  
  if (!category_id) {
    alert('Selecione uma categoria.');
    return;
  }
  
  const payment_method = document.getElementById('trans-payment-method').value;
  const status = document.getElementById('trans-status').value;
  
  let credit_card_id = null;
  if (payment_method === 'credit_card') {
    credit_card_id = parseInt(document.getElementById('trans-credit-card').value);
    if (!credit_card_id) {
      alert('Selecione um cartão de crédito.');
      return;
    }
  }

  const is_recurring = document.getElementById('trans-is-recurring').checked;
  const is_split = type === 'expense' && document.getElementById('trans-is-split').checked;
  let installments = null;
  
  if (is_split) {
    installments = parseInt(document.getElementById('trans-installments').value);
  }

  const payload = {
    description, amount, date, category_id, type, status,
    payment_method, credit_card_id, installments, is_recurring
  };

  if (id) {
    payload.id = id;
  }

  const recurrenceIdStr = document.getElementById('trans-recurrence-id').value;
  const recurrenceId = recurrenceIdStr ? parseInt(recurrenceIdStr) : null;
  const recurrenceMonth = document.getElementById('trans-recurrence-month').value;
  
  const isRecurrenceScopeAll = document.getElementById('group-recurrence-edit-scope').style.display !== 'none' && 
                               document.querySelector('input[name="trans-recurrence-scope"]:checked').value === 'all';
  
  const isRecurrenceEdit = recurrenceId && (isRecurrenceScopeAll || !id);

  if (isRecurrenceEdit) {
    const recPayload = {
      id: recurrenceId,
      month: recurrenceMonth,
      description,
      amount,
      category_id,
      type,
      payment_method,
      credit_card_id,
      date
    };

    try {
      const result = await API.updateRecurrence(recPayload);
      if (result && !result.error) {
        closeModal('modal-transaction');
        loadCurrentScreenData();
        loadDashboardData(getYearMonthString());
      } else {
        alert('Erro ao salvar recorrência: ' + (result ? result.error : 'Erro desconhecido'));
      }
    } catch (err) {
      console.error('Erro na submissão de recorrência:', err);
    }
    return;
  }

  try {
    const result = id ? await API.updateTransaction(payload) : await API.addTransaction(payload);
    if (result && !result.error) {
      closeModal('modal-transaction');
      
      // Recarregar dados
      loadCurrentScreenData();
      loadDashboardData(getYearMonthString());
    } else {
      alert('Erro ao salvar transação: ' + (result ? result.error : 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('Erro na submissão de transação:', err);
  }
}

// SUBMISSÃO NOVO CARTÃO
async function handleCardSubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById('card-name').value;
  const closing_day = parseInt(document.getElementById('card-closing').value);
  const due_day = parseInt(document.getElementById('card-due').value);
  const credit_limit = parseFloat(document.getElementById('card-limit').value);

  const payload = { name, closing_day, due_day, credit_limit };

  try {
    const result = await API.addCreditCard(payload);
    if (result && !result.error) {
      closeModal('modal-card');
      await loadBaseData(); // Recarregar cartões
      loadCurrentScreenData(); // Recarregar tela de cartões se ativa
    } else {
      alert('Erro ao criar cartão: ' + (result ? result.error : 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('Erro na submissão de cartão:', err);
  }
}

// SUBMISSÃO ORÇAMENTO (PLANEJAMENTO)
async function handleBudgetSubmit(e) {
  e.preventDefault();
  
  const category_id = parseInt(document.getElementById('budget-category').value);
  const amount = parseFloat(document.getElementById('budget-amount').value);
  const is_recurring = document.getElementById('budget-is-recurring').checked;
  const month = getYearMonthString();

  const payload = { category_id, month, amount, is_recurring };

  try {
    const result = await API.saveBudget(payload);
    if (result && !result.error) {
      closeModal('modal-budget');
      loadPlanningData(month); // Recarregar dados
    } else {
      alert('Erro ao definir orçamento: ' + (result ? result.error : 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('Erro na submissão do planejamento:', err);
  }
}

// SUBMISSÃO NOVA CATEGORIA
async function handleCategorySubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById('cat-name').value;
  const type = document.getElementById('cat-type').value;
  const parent = document.getElementById('cat-parent').value;
  const description = document.getElementById('cat-desc').value;

  const payload = { name, type, parent, description };

  try {
    const result = await API.addCategory(payload);
    if (result && !result.error) {
      // Limpar formulário
      document.getElementById('cat-name').value = '';
      document.getElementById('cat-desc').value = '';
      
      await loadBaseData(); // Recarregar categorias
      renderConfigScreen(); // Recarregar listagem
    } else {
      alert('Erro ao salvar categoria: ' + (result ? result.error : 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('Erro na submissão de categoria:', err);
  }
}

// ================= SUBTELA DETALHAMENTO DE CARTÃO & EDIÇÃO DE CARTÃO =================

function openCardDetails(cardId) {
  STATE.activeCardId = cardId;
  
  // Ocultar todas as telas e exibir subtela de detalhamento
  document.querySelectorAll('.app-screen').forEach(screen => {
    screen.style.display = 'none';
  });
  document.getElementById('screen-card-detail').style.display = 'block';
  STATE.activeScreen = 'card-detail';
  
  loadCardDetailData();
}

async function loadCardDetailData() {
  const card = STATE.creditCards.find(c => c.id === STATE.activeCardId);
  if (!card) {
    navigateTo('cards');
    return;
  }
  
  // Atualizar título com nome do cartão
  document.getElementById('card-detail-title-badge').textContent = `Cartão: ${card.name}`;
  
  // Format Card Detail Month Header
  const y = STATE.currentDate.getFullYear();
  const m = String(STATE.currentDate.getMonth() + 1).padStart(2, '0');
  const cardBillMonth = `${y}-${m}`;
  
  const monthName = MONTH_NAMES[STATE.currentDate.getMonth()];
  document.getElementById('card-month-display').textContent = `${monthName} ${y}`;
  
  try {
    // Buscar transações correspondentes ao mês da fatura
    const transactions = await API.getTransactions(cardBillMonth);
    
    // Armazenar no estado global para permitir edição/exclusão
    STATE.transactions = transactions;
    
    // Filtrar transações de cartão para este cartão específico
    const cardTrans = transactions.filter(t => t.payment_method === 'credit_card' && t.credit_card_id === card.id);
    
    // Calcular total gasto nesta fatura
    const totalSpent = cardTrans.reduce((sum, t) => sum + t.amount, 0.0);
    document.getElementById('card-detail-bill-amount').textContent = formatCurrency(totalSpent);
    
    // Renderizar tabela de lançamentos
    const tbody = document.getElementById('card-transactions-table-body');
    const emptyState = document.getElementById('card-transactions-empty-state');
    tbody.innerHTML = '';
    
    if (cardTrans.length === 0) {
      emptyState.style.display = 'flex';
      tbody.parentElement.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.parentElement.style.display = 'table';
      
      cardTrans.forEach(t => {
        const tr = document.createElement('tr');
        const isRealized = t.status === 'realized';
        const statusText = isRealized ? 'Pago' : 'Pendente';
        const statusClass = isRealized ? 'realized' : 'pending';
        
        let actionsHtml = '';
        if (t.status === 'pending') {
          actionsHtml += `
            <button class="btn-action commit" title="Efetivar lançamento" onclick="realizeTransaction('${t.id}', ${t.recurrence_id || 'null'}, '${t.date}')">
              <i data-lucide="check"></i>
            </button>
          `;
        }
        if (t.is_projected) {
          actionsHtml += `
            <button class="btn-action edit" title="Editar recorrência" onclick="editTransaction('${t.id}')" style="color: var(--primary); background-color: var(--primary-light); margin-right: 4px;">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn-action delete" title="Excluir recorrência" onclick="deleteRecurrence('${t.recurrence_id}', '${t.date}')">
              <i data-lucide="trash-2"></i>
            </button>
          `;
        } else {
          actionsHtml += `
            <button class="btn-action edit" title="Editar lançamento" onclick="editTransaction('${t.id}')" style="color: var(--primary); background-color: var(--primary-light); margin-right: 4px;">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn-action delete" title="Excluir lançamento" onclick="deleteTransaction('${t.id}')">
              <i data-lucide="trash-2"></i>
            </button>
          `;
        }

        if (t.installment_group_id) {
          actionsHtml += `
            <button class="btn-action edit" title="Ver detalhes do parcelamento" onclick="showInstallmentDetails('${t.installment_group_id}')" style="color: var(--primary); background-color: var(--primary-light); margin-right: 4px;">
              <i data-lucide="info"></i>
            </button>
          `;
        }
        
        tr.innerHTML = `
          <td><span class="badge-status ${statusClass}">${statusText}</span></td>
          <td>${formatDate(t.date).substring(0, 5)}</td>
          <td>
            <span style="font-weight: 600;">${t.description || t.category_name || 'Sem descrição'}</span>
            ${t.installment_number ? `<br><span class="badge-status pending" style="cursor: pointer; margin-top: 4px; font-size: 10px; background-color: var(--primary-light); color: var(--primary); display: inline-flex; align-items: center; gap: 4px;" onclick="showInstallmentDetails('${t.installment_group_id}')"><i data-lucide="info" style="width: 10px; height: 10px;"></i>Parcela ${t.installment_number}/${t.installments_total}</span>` : ''}
          </td>
          <td>
            ${t.category_parent ? `<small class="text-muted" style="display:block;">${t.category_parent}</small>` : ''}
            <span>${t.category_name || 'Geral'}</span>
          </td>
          <td class="value-negative" style="font-weight:700;">-${formatCurrency(t.amount)}</td>
          <td>
            <div class="actions-cell">
              ${actionsHtml}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
    
    // Mostrar/ocultar botão de pagamento de fatura
    const hasPending = cardTrans.some(t => t.status === 'pending');
    const payBtnContainer = document.getElementById('card-bill-pay-btn-container');
    if (payBtnContainer) {
      payBtnContainer.style.display = hasPending ? 'block' : 'none';
    }
    
    // Status da Fatura
    const currentRealMonthStr = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    })();
    
    const statusEl = document.getElementById('card-detail-bill-status');
    if (cardBillMonth >= currentRealMonthStr) {
      statusEl.textContent = 'Fatura aberta';
      statusEl.style.color = 'var(--primary)';
    } else {
      statusEl.textContent = 'Fatura fechada';
      statusEl.style.color = 'var(--text-muted)';
    }
    
    // Datas de fechamento e vencimento
    const { closingDate, dueDate } = getBillClosingAndDueDates(card, cardBillMonth);
    document.getElementById('card-detail-closing-date').textContent = formatDateLong(closingDate);
    document.getElementById('card-detail-due-date').textContent = formatDateLong(dueDate);
    
    lucide.createIcons();
    
  } catch (err) {
    console.error('Erro ao buscar dados detalhados do cartão:', err);
  }
}

async function handlePayCardBill() {
  const card = STATE.creditCards.find(c => c.id === STATE.activeCardId);
  if (!card) return;

  const y = STATE.currentDate.getFullYear();
  const m = String(STATE.currentDate.getMonth() + 1).padStart(2, '0');
  const cardBillMonth = `${y}-${m}`;

  if (!confirm(`Deseja realmente confirmar o pagamento da fatura do cartão "${card.name}" para o mês ${MONTH_NAMES[STATE.currentDate.getMonth()]} de ${y}?\n\nTodos os lançamentos pendentes e recorrências ativas deste período serão efetivados (marcados como pagos).`)) {
    return;
  }

  try {
    const result = await API.payCreditCardBill({
      credit_card_id: card.id,
      month: cardBillMonth
    });

    if (result && result.success) {
      loadCardDetailData();
      loadDashboardData(getYearMonthString());
    } else {
      alert('Erro ao pagar fatura do cartão: ' + (result ? result.error : 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('Erro na requisição de pagamento de fatura:', err);
    alert('Erro ao processar o pagamento da fatura.');
  }
}

function changeCardMonth(delta) {
  STATE.currentDate.setMonth(STATE.currentDate.getMonth() + delta);
  updateMonthHeader();
  loadCardDetailData();
}

function openEditCardModal() {
  const card = STATE.creditCards.find(c => c.id === STATE.activeCardId);
  if (!card) return;
  
  document.getElementById('edit-card-id').value = card.id;
  document.getElementById('edit-card-name').value = card.name;
  document.getElementById('edit-card-closing').value = card.closing_day;
  document.getElementById('edit-card-due').value = card.due_day;
  document.getElementById('edit-card-limit').value = card.credit_limit;
  
  openModal('modal-edit-card');
}

async function handleEditCardSubmit(e) {
  e.preventDefault();
  
  const id = parseInt(document.getElementById('edit-card-id').value);
  const name = document.getElementById('edit-card-name').value;
  const closing_day = parseInt(document.getElementById('edit-card-closing').value);
  const due_day = parseInt(document.getElementById('edit-card-due').value);
  const credit_limit = parseFloat(document.getElementById('edit-card-limit').value);
  
  const payload = { id, name, closing_day, due_day, credit_limit };
  
  try {
    const result = await API.updateCreditCard(payload);
    if (result && !result.error) {
      closeModal('modal-edit-card');
      await loadBaseData(); // Recarregar cartões na memória
      loadCardDetailData(); // Recarregar tela com novas datas/faturas
    } else {
      alert('Erro ao atualizar cartão: ' + (result ? result.error : 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('Erro ao salvar alterações do cartão:', err);
  }
}

function getBillClosingAndDueDates(card, billingMonthStr) {
  const [year, month] = billingMonthStr.split('-').map(Number);
  
  const maxDaysInMonth = new Date(year, month, 0).getDate();
  const closingDay = Math.min(card.closing_day, maxDaysInMonth);
  const closingDate = new Date(year, month - 1, closingDay);
  
  let dueYear = year;
  let dueMonth = month;
  if (card.due_day <= card.closing_day) {
    dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
  }
  const maxDaysInDueMonth = new Date(dueYear, dueMonth, 0).getDate();
  const dueDay = Math.min(card.due_day, maxDaysInDueMonth);
  const dueDate = new Date(dueYear, dueMonth - 1, dueDay);
  
  return { closingDate, dueDate };
}

function formatDateLong(date) {
  const day = date.getDate();
  const monthName = MONTH_NAMES[date.getMonth()].toLowerCase();
  const year = date.getFullYear();
  return `${day} de ${monthName} de ${year}`;
}

// ================= LÓGICA DO RELATÓRIO MENSAL =================

async function loadMonthlyReport() {
  const month = getYearMonthString();
  try {
    // Garantir que o seletor de ano esteja oculto
    document.getElementById('report-year-selector-container').style.display = 'none';
    
    // Obter dados financeiros do mês
    const data = await API.getDashboard(month);
    
    // Atualizar os cards de totais
    document.getElementById('rep-income-val').textContent = formatCurrency(data.totals.totalIncome);
    document.getElementById('rep-expense-val').textContent = formatCurrency(data.totals.totalExpense);
    
    const balanceVal = data.totals.totalIncome - data.totals.totalExpense;
    const balanceEl = document.getElementById('rep-balance-val');
    balanceEl.textContent = formatCurrency(balanceVal);
    if (balanceVal < 0) {
      balanceEl.className = 'value-negative';
    } else {
      balanceEl.className = 'value-positive';
    }
    
    document.getElementById('rep-card-val').textContent = formatCurrency(data.totals.creditCardTotal);
    
    // Escolher dados conforme tipo selecionado no dropdown (despesa ou receita)
    const type = document.getElementById('report-monthly-type').value;
    const categoryData = type === 'expense' ? data.categoryExpenses : data.categoryIncomes;
    
    // Renderizar o gráfico de rosca
    renderMonthlyReportChart(categoryData, type);
    
    // Renderizar o detalhamento em lista/tabela
    renderMonthlyReportCategoriesList(categoryData);
    
  } catch (err) {
    console.error('Erro ao carregar relatório mensal:', err);
  }
}

function renderMonthlyReportChart(categoryData, type) {
  const ctx = document.getElementById('chartReportsMonthly').getContext('2d');
  
  if (STATE.charts.reportsMonthly) {
    STATE.charts.reportsMonthly.destroy();
  }
  
  const noDataEl = document.getElementById('rep-chart-no-data');
  const canvasEl = document.getElementById('chartReportsMonthly');
  
  if (!categoryData || categoryData.length === 0) {
    noDataEl.style.display = 'flex';
    canvasEl.style.display = 'none';
    return;
  }
  
  noDataEl.style.display = 'none';
  canvasEl.style.display = 'block';
  
  const colors = [
    '#5e17eb', '#00bfa5', '#ff9100', '#d32f2f', '#1976d2',
    '#9c27b0', '#e91e63', '#4caf50', '#ffeb3b', '#795548'
  ];
  
  STATE.charts.reportsMonthly = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: categoryData.map(c => c.name),
      datasets: [{
        data: categoryData.map(c => c.value),
        backgroundColor: categoryData.map((_, i) => colors[i % colors.length]),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { family: 'Outfit', size: 12 },
            boxWidth: 12
          }
        }
      },
      cutout: '65%'
    }
  });
}

function renderMonthlyReportCategoriesList(categoryData) {
  const container = document.getElementById('report-category-list-container');
  container.innerHTML = '';
  
  if (!categoryData || categoryData.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px 0;">Nenhum lançamento registrado.</p>';
    return;
  }
  
  const colors = [
    '#5e17eb', '#00bfa5', '#ff9100', '#d32f2f', '#1976d2',
    '#9c27b0', '#e91e63', '#4caf50', '#ffeb3b', '#795548'
  ];
  
  categoryData.forEach((c, i) => {
    const color = colors[i % colors.length];
    const item = document.createElement('div');
    item.className = 'config-cat-item';
    item.style.backgroundColor = '#ffffff';
    item.style.border = '1px solid var(--border-color)';
    item.style.marginBottom = '8px';
    
    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="width: 12px; height: 12px; border-radius: 50%; background-color: ${color}; display: inline-block;"></span>
        <span class="config-cat-name" style="font-weight: 600; font-size: 14px;">${c.name}</span>
      </div>
      <span style="font-weight: 700; font-size: 14px; color: var(--text-main);">${formatCurrency(c.value)}</span>
    `;
    container.appendChild(item);
  });
}

// ================= EDITAR LANÇAMENTO (DESPESA OU PROVENTO) =================

function editTransaction(id) {
  let trans;
  if (String(id).startsWith('rec-')) {
    // É uma projeção virtual
    trans = STATE.transactions.find(t => t.id === id);
  } else {
    // É uma transação física
    trans = STATE.transactions.find(t => t.id === parseInt(id));
  }
  
  if (!trans) {
    alert('Lançamento não encontrado.');
    return;
  }
  
  openTransactionModalForEdit(trans);
}

function openTransactionModalForEdit(trans) {
  // Limpar/Setar inputs ocultos de recorrência
  const isVirtual = trans.is_projected || String(trans.id).startsWith('rec-');
  
  if (isVirtual) {
    document.getElementById('trans-id').value = '';
    document.getElementById('trans-recurrence-id').value = trans.recurrence_id;
    document.getElementById('trans-recurrence-month').value = trans.date.substring(0, 7);
    document.getElementById('modal-trans-title').textContent = trans.type === 'expense' ? 'Editar Despesa Recorrente' : 'Editar Receita Recorrente';
    document.getElementById('group-recurrence-edit-scope').style.display = 'none';
  } else if (trans.recurrence_id) {
    document.getElementById('trans-id').value = trans.id;
    document.getElementById('trans-recurrence-id').value = trans.recurrence_id;
    document.getElementById('trans-recurrence-month').value = trans.date.substring(0, 7);
    document.getElementById('modal-trans-title').textContent = trans.type === 'expense' ? 'Editar Despesa' : 'Editar Receita';
    document.getElementById('group-recurrence-edit-scope').style.display = 'block';
    document.getElementById('scope-single').checked = true; // reset to single edit by default
  } else {
    document.getElementById('trans-id').value = trans.id;
    document.getElementById('trans-recurrence-id').value = '';
    document.getElementById('trans-recurrence-month').value = '';
    document.getElementById('modal-trans-title').textContent = trans.type === 'expense' ? 'Editar Despesa' : 'Editar Receita';
    document.getElementById('group-recurrence-edit-scope').style.display = 'none';
  }

  document.getElementById('trans-type').value = trans.type;
  document.getElementById('trans-amount').value = trans.amount;
  document.getElementById('trans-desc').value = trans.description || '';
  document.getElementById('trans-date').value = trans.date;
  
  // Carregar categorias principais do tipo correspondente
  filterCategoriesSelect(trans.type);
  
  // Identificar se o category_id é categoria principal ou subcategoria
  const selectedCat = STATE.categories.find(c => c.id === trans.category_id);
  if (selectedCat) {
    if (selectedCat.parent) {
      // É uma subcategoria
      const mainCat = STATE.categories.find(c => !c.parent && c.name === selectedCat.parent && c.type === trans.type);
      if (mainCat) {
        document.getElementById('trans-category-main').value = mainCat.id;
        updateSubcategoriesDropdown(mainCat.id);
        document.getElementById('trans-category-sub').value = selectedCat.id;
      }
    } else {
      // É uma categoria principal
      document.getElementById('trans-category-main').value = selectedCat.id;
      updateSubcategoriesDropdown(selectedCat.id);
      document.getElementById('trans-category-sub').value = '';
    }
  }
  
  document.getElementById('trans-payment-method').value = trans.payment_method;
  
  if (trans.payment_method === 'credit_card') {
    document.getElementById('group-credit-card').style.display = 'block';
    document.getElementById('trans-credit-card').value = trans.credit_card_id || '';
    document.getElementById('trans-credit-card').required = true;
  } else {
    document.getElementById('group-credit-card').style.display = 'none';
    document.getElementById('trans-credit-card').required = false;
  }
  
  // Ocultar opções de parcelamento e recorrência na edição da transação física individual ou recorrência existente
  document.getElementById('recurrence-special-fields').style.display = 'none';
  document.getElementById('split-special-fields').style.display = 'none';
  
  document.getElementById('trans-is-recurring').checked = false;
  document.getElementById('trans-is-split').checked = false;
  document.getElementById('group-installments').style.display = 'none';
  
  document.getElementById('trans-status').value = trans.status;
  
  openModal('modal-transaction');
}

async function showInstallmentDetails(groupId) {
  try {
    const data = await API.getInstallmentsSummary(groupId);
    if (!data || data.error) {
      alert('Erro ao carregar detalhes do parcelamento: ' + (data ? data.error : 'Erro desconhecido'));
      return;
    }
    
    // Atualizar cabeçalhos de resumo
    document.getElementById('inst-detail-total').textContent = formatCurrency(data.totalAmount);
    document.getElementById('inst-detail-paid').textContent = formatCurrency(data.paidAmount);
    document.getElementById('inst-detail-remaining').textContent = formatCurrency(data.pendingAmount);
    
    // Progresso
    let percent = 0;
    if (data.totalAmount > 0) {
      percent = Math.round((data.paidAmount / data.totalAmount) * 100);
    }
    document.getElementById('inst-progress-label').textContent = `Progresso da quitação: ${percent}%`;
    document.getElementById('inst-progress-bar').style.width = `${percent}%`;
    
    // Preencher a tabela
    const tbody = document.getElementById('inst-detail-table-body');
    tbody.innerHTML = '';
    
    data.installments.forEach(inst => {
      const tr = document.createElement('tr');
      const isRealized = inst.status === 'realized';
      const statusText = isRealized ? 'Pago' : 'Pendente';
      const statusClass = isRealized ? 'realized' : 'pending';
      const faturaText = inst.credit_card_bill_date ? formatDateMonthYear(inst.credit_card_bill_date) : 'N/A';
      
      tr.innerHTML = `
        <td style="padding: 8px 12px; font-weight: 600;">${inst.installment_number}/${inst.installments_total}</td>
        <td style="padding: 8px 12px;">${formatDate(inst.date).substring(0, 5)}</td>
        <td style="padding: 8px 12px;">${faturaText}</td>
        <td style="padding: 8px 12px; font-weight: 600; color: var(--danger-text);">${formatCurrency(inst.amount)}</td>
        <td style="padding: 8px 12px;"><span class="badge-status ${statusClass}" style="font-size: 10px; padding: 2px 6px;">${statusText}</span></td>
      `;
      tbody.appendChild(tr);
    });
    
    openModal('modal-installment-details');
    lucide.createIcons();
  } catch (err) {
    console.error('Erro ao processar detalhes do parcelamento:', err);
    alert('Erro ao carregar o detalhamento.');
  }
}

// Helper to format YYYY-MM into Month/YYYY (e.g. Junho 2026)
function formatDateMonthYear(dateStr) {
  const [year, month] = dateStr.split('-');
  const monthName = MONTH_NAMES[parseInt(month) - 1];
  return `${monthName.substring(0, 3)}/${year}`;
}




/* ==========================================================================
   FUNÇÕES AUXILIARES DE SINCRONIZAÇÃO E UI DO GOOGLE DRIVE (PWA)
   ========================================================================== */

function setupSyncIndicator() {
  API.onSyncStatusChange = (status) => {
    updateSyncUI(status);
  };
  // Inicializa com o status atual
  updateSyncUI(API.syncStatus);
}

function updateSyncUI(status) {
  const container = document.getElementById('sync-indicator');
  const divider = document.getElementById('sync-divider');
  const icon = document.getElementById('sync-icon');
  const text = document.getElementById('sync-text');
  
  if (!container) return;
  
  if (API.mode !== 'drive') {
    container.style.display = 'none';
    if (divider) divider.style.display = 'none';
    return;
  }
  
  container.style.display = 'flex';
  if (divider) divider.style.display = 'block';
  
  // Limpa classes
  container.className = 'sync-indicator-container';
  
  if (status === 'synced') {
    container.classList.add('synced');
    icon.innerHTML = '<i data-lucide="check-circle" style="width:14px; height:14px;"></i>';
    text.textContent = 'Salvo no Drive';
  } else if (status === 'syncing') {
    container.classList.add('syncing');
    icon.innerHTML = '<i data-lucide="refresh-cw" style="width:14px; height:14px;" class="icon-spin"></i>';
    text.textContent = 'Salvando...';
  } else if (status === 'pending') {
    container.classList.add('pending');
    icon.innerHTML = '<i data-lucide="clock" style="width:14px; height:14px;"></i>';
    text.textContent = 'Mudanças locais';
  } else if (status === 'error') {
    container.classList.add('error');
    icon.innerHTML = '<i data-lucide="alert-triangle" style="width:14px; height:14px;"></i>';
    text.textContent = 'Erro de Sync';
  }
  
  lucide.createIcons();
}

function setupGoogleDriveUI() {
  const clientIdInput = document.getElementById('drive-client-id');
  const saveBtn = document.getElementById('btn-save-client-id');
  const connectBtn = document.getElementById('btn-drive-connect');
  const disconnectBtn = document.getElementById('btn-drive-disconnect');
  const toggleBtn = document.getElementById('btn-drive-mode-toggle');
  const statusAuth = document.getElementById('drive-status-auth');
  const fileInfo = document.getElementById('drive-status-file-info');
  const badgeMode = document.getElementById('drive-badge-mode');

  if (!clientIdInput) return;

  // Preenche ID salvo se existir
  clientIdInput.value = API.drive.clientId || '';

  // Configura botões dependendo da existência do Client ID
  if (API.drive.clientId) {
    connectBtn.disabled = false;
    toggleBtn.disabled = false;
  } else {
    connectBtn.disabled = true;
    toggleBtn.disabled = true;
  }

  // Atualiza informações de status
  if (API.drive.isAuthorized()) {
    statusAuth.textContent = 'Conectando...';
    statusAuth.className = 'value-positive';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-flex';
    
    API.drive.getUserInfo().then(user => {
      if (user && user.email) {
        statusAuth.textContent = 'Conectado (' + user.email + ')';
      } else {
        statusAuth.textContent = 'Conectado';
      }
    }).catch(() => {
      statusAuth.textContent = 'Conectado';
    });
    
    fileInfo.textContent = 'Buscando banco de dados no Drive...';
    API.drive.findDatabaseFile().then(file => {
      if (file) {
        fileInfo.textContent = 'Banco de Dados: finance.db (ID: ' + file.id + ')';
      } else {
        fileInfo.textContent = 'Banco de Dados: Não localizado no Drive';
      }
    }).catch(err => {
      fileInfo.textContent = 'Banco de Dados: ' + err.message;
      console.error(err);
    });
  } else {
    statusAuth.textContent = 'Desconectado';
    statusAuth.className = 'value-negative';
    connectBtn.style.display = 'inline-flex';
    disconnectBtn.style.display = 'none';
    fileInfo.textContent = 'Banco de Dados: Não carregado';
  }

  // Atualiza badge de modo
  if (API.mode === 'drive') {
    badgeMode.textContent = 'Modo Google Drive';
    badgeMode.style.backgroundColor = 'var(--primary-light)';
    badgeMode.style.color = 'var(--primary)';
    toggleBtn.textContent = 'Mudar para Modo Local';
  } else {
    badgeMode.textContent = 'Modo Local (PC)';
    badgeMode.style.backgroundColor = 'var(--border-color)';
    badgeMode.style.color = 'var(--text-muted)';
    toggleBtn.textContent = 'Mudar para Modo Google Drive';
  }

  // Vincula eventos do painel
  saveBtn.onclick = () => {
    const val = clientIdInput.value.trim();
    if (!val) {
      alert('Insira um Client ID válido.');
      return;
    }
    API.drive.setClientId(val);
    alert('Google Client ID salvo com sucesso!');
    setupGoogleDriveUI();
  };

  connectBtn.onclick = () => {
    API.drive.login();
  };

  disconnectBtn.onclick = () => {
    if (confirm('Deseja realmente desconectar sua conta do Google Drive? O aplicativo voltará ao modo local.')) {
      API.drive.logout();
      API.setMode('server');
      window.location.reload();
    }
  };

  toggleBtn.onclick = () => {
    if (API.mode === 'server') {
      if (!API.drive.isAuthorized()) {
        alert('Por favor, conecte sua conta Google primeiro.');
        return;
      }
      if (confirm('Deseja ativar o Modo Google Drive? O aplicativo carregará o banco de dados da nuvem.')) {
        API.setMode('drive');
        window.location.reload();
      }
    } else {
      if (confirm('Deseja voltar para o Modo Local? O app lerá o servidor rodando no seu computador.')) {
        API.setMode('server');
        window.location.reload();
      }
    }
  };

  // Vincula a mudança de status de login da Google
  API.drive.onAuthChange = async (authorized) => {
    setupGoogleDriveUI();
    if (authorized && API.mode === 'drive') {
      try {
        await API.initDriveMode();
        window.location.reload();
      } catch (err) {
        alert('Erro ao sincronizar banco após login: ' + err.message);
      }
    }
  };
}
