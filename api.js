/**
 * Roteador de API Unificado para o Frontend.
 * Abstrai as chamadas entre o servidor local (legado) e o banco de dados WASM + Google Drive.
 */

class APIRouter {
  constructor() {
    this.mode = localStorage.getItem('fin_app_mode') || 'server'; // 'server' ou 'drive'
    this.db = new window.LocalDBEngine();
    this.drive = new window.GoogleDriveService();
    this.syncTimeout = null;
    this.syncStatus = 'synced'; // 'synced', 'syncing', 'pending', 'error'
    this.onSyncStatusChange = null; // Callback para o frontend atualizar o ícone de sincronização
    
    // Vincular estado de login da Google ao roteador
    this.drive.onAuthChange = (authorized) => {
      if (!authorized && this.mode === 'drive') {
        console.warn('Sessão Google expirada ou deslogada.');
        this.setSyncStatus('error');
      }
    };
  }

  setMode(mode) {
    this.mode = mode;
    localStorage.setItem('fin_app_mode', mode);
  }

  setSyncStatus(status) {
    this.syncStatus = status;
    if (this.onSyncStatusChange) {
      this.onSyncStatusChange(status);
    }
  }

  /**
   * Inicializa o banco de dados no modo Google Drive
   */
  async initDriveMode() {
    if (this.mode !== 'drive') return;
    
    this.setSyncStatus('syncing');
    try {
      if (!this.drive.isAuthorized()) {
        throw new Error('Google Drive não está autenticado. Vá em Configurações para conectar.');
      }

      // 1. Procurar ou salvar arquivo no Google Drive
      let file = await this.drive.findDatabaseFile();
      let arrayBuffer = null;

      if (file) {
        console.log(`Arquivo finance.db encontrado no Google Drive. ID: ${file.id}`);
        arrayBuffer = await this.drive.downloadDatabaseFile(file.id);
      } else {
        console.log('Nenhum arquivo finance.db encontrado. Criando um novo...');
        // Inicializa banco local vazio para gerar o schema padrão
        await this.db.init(null);
        const newDbContent = this.db.export();
        
        // Faz upload para o Drive
        const newFileId = await this.drive.uploadDatabaseFile(newDbContent);
        console.log(`Novo arquivo finance.db criado no Drive com ID: ${newFileId}`);
        this.setSyncStatus('synced');
        return;
      }

      // 2. Inicializar o WebAssembly SQLite com o arquivo baixado
      await this.db.init(arrayBuffer);
      this.setSyncStatus('synced');
      console.log('Banco de dados SQLite carregado com sucesso em memória!');

    } catch (err) {
      console.error('Falha ao inicializar o banco pelo Google Drive:', err);
      this.setSyncStatus('error');
      throw err;
    }
  }

  /**
   * Agenda uma sincronização assíncrona (com debounce) para salvar o banco no Google Drive
   */
  scheduleSync() {
    if (this.mode !== 'drive') return;
    
    this.setSyncStatus('pending'); // Alterações locais pendentes de envio
    
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    this.syncTimeout = setTimeout(async () => {
      await this.syncNow();
    }, 2000); // Aguarda 2 segundos de inatividade para enviar o arquivo completo
  }

  /**
   * Força a sincronização imediata
   */
  async syncNow() {
    if (this.mode !== 'drive') return;
    
    this.setSyncStatus('syncing');
    try {
      const dbContent = this.db.export();
      await this.drive.updateDatabaseFile(dbContent);
      this.setSyncStatus('synced');
      console.log('Base de dados atualizada com sucesso no Google Drive!');
    } catch (err) {
      console.error('Erro na sincronização automática:', err);
      this.setSyncStatus('error');
    }
  }

  // --- MÉTODOS PÚBLICOS DO COMPARTILHAMENTO DE API ---

  // 1. Categorias
  async getCategories() {
    if (this.mode === 'drive') {
      return this.db.getCategories();
    }
    const res = await fetch('/api/categories');
    return await res.json();
  }

  async addCategory(body) {
    if (this.mode === 'drive') {
      const result = this.db.addCategory(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  // 2. Cartões de Crédito
  async getCreditCards() {
    if (this.mode === 'drive') {
      return this.db.getCreditCards();
    }
    const res = await fetch('/api/credit-cards');
    return await res.json();
  }

  async addCreditCard(body) {
    if (this.mode === 'drive') {
      const result = this.db.addCreditCard(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/credit-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  async updateCreditCard(body) {
    if (this.mode === 'drive') {
      const result = this.db.updateCreditCard(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/credit-cards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  async payCreditCardBill(body) {
    if (this.mode === 'drive') {
      const result = this.db.payCreditCardBill(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/credit-cards/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  // 3. Transações
  async getTransactions(month) {
    if (this.mode === 'drive') {
      return this.db.getTransactions(month);
    }
    const res = await fetch(`/api/transactions?month=${month}`);
    return await res.json();
  }

  async addTransaction(body) {
    if (this.mode === 'drive') {
      const result = this.db.addTransaction(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  async updateTransaction(body) {
    if (this.mode === 'drive') {
      const result = this.db.updateTransaction(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/transactions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  async deleteTransaction(id) {
    if (this.mode === 'drive') {
      const result = this.db.deleteTransaction(id);
      this.scheduleSync();
      return result;
    }
    const res = await fetch(`/api/transactions?id=${id}`, {
      method: 'DELETE'
    });
    return await res.json();
  }

  async getInstallmentsSummary(groupId) {
    if (this.mode === 'drive') {
      return this.db.getInstallmentsSummary(groupId);
    }
    const res = await fetch(`/api/installments/summary?group_id=${groupId}`);
    return await res.json();
  }

  async realizeTransaction(body) {
    if (this.mode === 'drive') {
      const result = this.db.realizeTransaction(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/transactions/realize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  // 4. Budgets
  async getBudgets(month) {
    if (this.mode === 'drive') {
      return this.db.getBudgets(month);
    }
    const res = await fetch(`/api/budgets?month=${month}`);
    return await res.json();
  }

  async saveBudget(body) {
    if (this.mode === 'drive') {
      const result = this.db.saveBudget(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  // 5. Recorrências
  async getRecurrences() {
    if (this.mode === 'drive') {
      return this.db.getRecurrences();
    }
    const res = await fetch('/api/recurrences');
    return await res.json();
  }

  async deleteRecurrence(id, month) {
    if (this.mode === 'drive') {
      const result = this.db.deleteRecurrence(id, month);
      this.scheduleSync();
      return result;
    }
    let url = `/api/recurrences?id=${id}`;
    if (month) url += `&month=${month}`;
    const res = await fetch(url, {
      method: 'DELETE'
    });
    return await res.json();
  }

  async updateRecurrence(body) {
    if (this.mode === 'drive') {
      const result = this.db.updateRecurrence(body);
      this.scheduleSync();
      return result;
    }
    const res = await fetch('/api/recurrences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }

  // 6. Dashboard
  async getDashboard(month) {
    if (this.mode === 'drive') {
      return this.db.getDashboard(month);
    }
    const res = await fetch(`/api/dashboard?month=${month}`);
    return await res.json();
  }

  // 7. Relatório Anual
  async getAnnualReport(year) {
    if (this.mode === 'drive') {
      return this.db.getAnnualReport(year);
    }
    const res = await fetch(`/api/reports/annual?year=${year}`);
    return await res.json();
  }
}

// Inicializar globalmente
window.API = new APIRouter();
