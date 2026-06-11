/**
 * Engine de Banco de Dados SQLite Local usando WebAssembly (sql.js)
 * Replica toda a lógica de negócio do server.js no lado do cliente (PWA).
 */

// Helpers de Datas (Copiados do server.js)
function addMonths(dateStr, months) {
  const date = new Date(dateStr + 'T00:00:00');
  const originalDay = date.getDate();
  
  date.setMonth(date.getMonth() + months);
  
  if (date.getDate() !== originalDay) {
    date.setDate(0);
  }
  
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCreditCardBillDate(card, dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const closingDay = card.closing_day;
  const day = date.getDate();
  let billYear = date.getFullYear();
  let billMonth = date.getMonth(); // 0-indexed

  if (day > closingDay) {
    billMonth += 1;
    if (billMonth > 11) {
      billMonth = 0;
      billYear += 1;
    }
  }

  const monthStr = String(billMonth + 1).padStart(2, '0');
  return `${billYear}-${monthStr}`;
}

class LocalDBEngine {
  constructor() {
    this.db = null;
  }

  /**
   * Inicializa o banco de dados. Se receber um arrayBuffer, abre o banco existente.
   * Caso contrário, cria um novo banco com o schema padrão.
   */
  async init(arrayBuffer = null) {
    if (typeof window.initSqlJs !== 'function') {
      throw new Error('A biblioteca sql.js não foi carregada no escopo global.');
    }
    
    const SQL = await window.initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${file}`
    });

    if (arrayBuffer && arrayBuffer.byteLength > 0) {
      this.db = new SQL.Database(new Uint8Array(arrayBuffer));
      // Garante a coluna is_deleted nas transações
      try {
        this.db.run("ALTER TABLE transactions ADD COLUMN is_deleted INTEGER DEFAULT 0");
      } catch (err) {
        // Ignorar se a coluna já existe
      }
    } else {
      this.db = new SQL.Database();
      this.createSchema();
    }
  }

  /**
   * Exporta a base de dados como um Uint8Array para upload
   */
  export() {
    if (!this.db) throw new Error('Banco de dados não inicializado.');
    return this.db.export();
  }

  /**
   * Criação do Schema padrão (Sincronizado com db_init.js)
   */
  createSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
        parent TEXT,
        description TEXT
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS credit_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        closing_day INTEGER NOT NULL CHECK(closing_day BETWEEN 1 AND 31),
        due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
        credit_limit REAL NOT NULL DEFAULT 0.0
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS recurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        category_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
        frequency TEXT NOT NULL DEFAULT 'monthly',
        start_date TEXT NOT NULL,
        end_date TEXT,
        payment_method TEXT NOT NULL DEFAULT 'money',
        credit_card_id INTEGER,
        FOREIGN KEY(category_id) REFERENCES categories(id),
        FOREIGN KEY(credit_card_id) REFERENCES credit_cards(id)
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'realized')),
        payment_method TEXT NOT NULL DEFAULT 'money',
        credit_card_id INTEGER,
        credit_card_bill_date TEXT,
        installment_group_id TEXT,
        installment_number INTEGER,
        installments_total INTEGER,
        recurrence_id INTEGER,
        is_deleted INTEGER DEFAULT 0,
        FOREIGN KEY(category_id) REFERENCES categories(id),
        FOREIGN KEY(credit_card_id) REFERENCES credit_cards(id),
        FOREIGN KEY(recurrence_id) REFERENCES recurrences(id)
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        month TEXT NOT NULL, -- YYYY-MM
        amount REAL NOT NULL,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(category_id) REFERENCES categories(id),
        UNIQUE(category_id, month)
      );
    `);

    this.seedDefaultCategories();
    this.seedDefaultCreditCards();
  }

  // Seeding de Categorias padrão caso banco seja novo
  seedDefaultCategories() {
    const check = this.queryOne("SELECT COUNT(*) as count FROM categories");
    if (check.count > 0) return;

    const defaultCats = [
      // Principais e Subcategorias
      { name: 'Casa', type: 'expense', parent: null, desc: 'Moradia e despesas da casa' },
      { name: 'Aluguel / Financiamento', type: 'expense', parent: 'Casa', desc: '' },
      { name: 'Condomínio', type: 'expense', parent: 'Casa', desc: '' },
      { name: 'Luz / Água / Gás', type: 'expense', parent: 'Casa', desc: '' },
      { name: 'Internet / Telefone', type: 'expense', parent: 'Casa', desc: '' },
      
      { name: 'Comidas', type: 'expense', parent: null, desc: 'Alimentação' },
      { name: 'Supermercado', type: 'expense', parent: 'Comidas', desc: '' },
      { name: 'Restaurante / Delivery', type: 'expense', parent: 'Comidas', desc: '' },
      { name: 'Feira / Padaria', type: 'expense', parent: 'Comidas', desc: '' },

      { name: 'Entretenimento', type: 'expense', parent: null, desc: 'Lazer e Diversão' },
      { name: 'Cinema / Streaming', type: 'expense', parent: 'Entretenimento', desc: '' },
      { name: 'Viagens', type: 'expense', parent: 'Entretenimento', desc: '' },
      
      { name: 'Transporte', type: 'expense', parent: null, desc: 'Locomoção' },
      { name: 'Combustível', type: 'expense', parent: 'Transporte', desc: '' },
      { name: 'Uber / Táxi', type: 'expense', parent: 'Transporte', desc: '' },
      
      { name: 'Pessoal', type: 'expense', parent: null, desc: 'Despesas pessoais' },
      { name: 'Academia', type: 'expense', parent: 'Pessoal', desc: '' },
      { name: 'Roupas', type: 'expense', parent: 'Pessoal', desc: '' },

      { name: 'Médico', type: 'expense', parent: null, desc: 'Saúde' },
      { name: 'Farmácia', type: 'expense', parent: 'Médico', desc: '' },
      { name: 'Consultas', type: 'expense', parent: 'Médico', desc: '' },

      { name: 'Proventos', type: 'income', parent: null, desc: 'Receitas' },
      { name: 'Salário', type: 'income', parent: 'Proventos', desc: '' },
      { name: 'Rendimentos', type: 'income', parent: 'Proventos', desc: '' }
    ];

    for (const cat of defaultCats) {
      this.runCommand(
        "INSERT INTO categories (name, type, parent, description) VALUES (?, ?, ?, ?)",
        [cat.name, cat.type, cat.parent, cat.desc]
      );
    }
  }

  seedDefaultCreditCards() {
    const check = this.queryOne("SELECT COUNT(*) as count FROM credit_cards");
    if (check.count > 0) return;

    this.runCommand("INSERT INTO credit_cards (name, closing_day, due_day, credit_limit) VALUES (?, ?, ?, ?)", ['Visa Principal', 25, 10, 5000.0]);
    this.runCommand("INSERT INTO credit_cards (name, closing_day, due_day, credit_limit) VALUES (?, ?, ?, ?)", ['Mastercard Liu', 5, 15, 3000.0]);
  }

  // Helpers de execução SQL
  queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  queryOne(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    let row = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  }

  runCommand(sql, params = []) {
    this.db.run(sql, params);
    // Em sql.js, recuperamos as alterações e o lastInsertRowid via chamadas específicas
    const lastInsertRowid = this.queryOne("SELECT last_insert_rowid() as id").id;
    const changes = this.queryOne("SELECT changes() as count").count;
    return { lastInsertRowid, changes };
  }

  // --- MÉTODOS DE NEGÓCIO PORTADOS DO SERVER.JS ---

  // 1. Categorias
  getCategories() {
    return this.queryAll('SELECT * FROM categories ORDER BY parent ASC, name ASC');
  }

  addCategory(body) {
    if (!body.name || !body.type) {
      throw new Error('Nome e tipo (expense/income) são obrigatórios.');
    }
    const result = this.runCommand(
      'INSERT INTO categories (name, type, parent, description) VALUES (?, ?, ?, ?)',
      [body.name, body.type, body.parent || null, body.description || null]
    );
    return { id: result.lastInsertRowid, ...body };
  }

  // 2. Cartões de Crédito
  getCreditCards() {
    return this.queryAll('SELECT * FROM credit_cards ORDER BY name ASC');
  }

  addCreditCard(body) {
    if (!body.name || !body.closing_day || !body.due_day || body.credit_limit === undefined) {
      throw new Error('Campos obrigatórios: name, closing_day, due_day, credit_limit.');
    }
    const result = this.runCommand(
      'INSERT INTO credit_cards (name, closing_day, due_day, credit_limit) VALUES (?, ?, ?, ?)',
      [body.name, parseInt(body.closing_day), parseInt(body.due_day), parseFloat(body.credit_limit)]
    );
    return { id: result.lastInsertRowid, ...body };
  }

  updateCreditCard(body) {
    const { id, name, closing_day, due_day, credit_limit } = body;
    if (!id || !name || !closing_day || !due_day || credit_limit === undefined) {
      throw new Error('Campos obrigatórios: id, name, closing_day, due_day, credit_limit.');
    }
    
    this.runCommand(`
      UPDATE credit_cards 
      SET name = ?, closing_day = ?, due_day = ?, credit_limit = ? 
      WHERE id = ?
    `, [name, parseInt(closing_day), parseInt(due_day), parseFloat(credit_limit), parseInt(id)]);

    const updatedCard = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [parseInt(id)]);

    // Recalcular credit_card_bill_date de todas as transações associadas
    const transactions = this.queryAll('SELECT id, date FROM transactions WHERE credit_card_id = ?', [parseInt(id)]);
    for (const t of transactions) {
      const newBillDate = getCreditCardBillDate(updatedCard, t.date);
      this.runCommand('UPDATE transactions SET credit_card_bill_date = ? WHERE id = ?', [newBillDate, t.id]);
    }

    return { success: true, card: updatedCard };
  }

  payCreditCardBill(body) {
    const { credit_card_id, month } = body;
    if (!credit_card_id || !month) {
      throw new Error('Campos obrigatórios: credit_card_id, month.');
    }
    
    const cardId = parseInt(credit_card_id);
    
    // 1. Efetivar lançamentos físicos existentes que estejam como 'pending'
    const updateResult = this.runCommand(`
      UPDATE transactions 
      SET status = 'realized' 
      WHERE credit_card_id = ? 
        AND credit_card_bill_date = ? 
        AND status = 'pending'
        AND (is_deleted IS NULL OR is_deleted = 0)
    `, [cardId, month]);
    
    let materializedCount = 0;
    
    // 2. Materializar e efetivar projeções virtuais de recorrências ativas
    const recurrences = this.queryAll(`
      SELECT r.* 
      FROM recurrences r 
      WHERE r.payment_method = 'credit_card' 
        AND r.credit_card_id = ? 
        AND r.start_date <= ? 
        AND (r.end_date IS NULL OR r.end_date >= ?)
    `, [cardId, `${month}-31`, `${month}-01`]);
    
    for (const rec of recurrences) {
      const exists = this.queryOne(`
        SELECT COUNT(*) as count 
        FROM transactions 
        WHERE recurrence_id = ? 
          AND credit_card_bill_date = ?
      `, [rec.id, month]);
      
      if (exists.count === 0) {
        const [yVal, mVal] = month.split('-').map(Number);
        const startDay = new Date(rec.start_date + 'T00:00:00').getDate();
        const maxDays = new Date(yVal, mVal, 0).getDate();
        const actualDay = Math.min(startDay, maxDays);
        const dateStr = `${month}-${String(actualDay).padStart(2, '0')}`;
        
        const card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [cardId]);
        if (card) {
          const billDate = getCreditCardBillDate(card, dateStr);
          if (billDate === month) {
            this.runCommand(`
              INSERT INTO transactions (description, amount, date, category_id, type, status, payment_method, credit_card_id, credit_card_bill_date, recurrence_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              rec.description,
              rec.amount,
              dateStr,
              rec.category_id,
              rec.type,
              'realized',
              'credit_card',
              cardId,
              billDate,
              rec.id
            ]);
            materializedCount++;
          }
        }
      }
    }
    
    return { success: true, updatedCount: updateResult.changes, materializedCount };
  }

  // 3. Transações
  getTransactions(month) {
    if (!month) {
      throw new Error('Parâmetro month (YYYY-MM) é obrigatório.');
    }

    const sql = `
      SELECT t.*, c.name as category_name, c.parent as category_parent, cc.name as credit_card_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN credit_cards cc ON t.credit_card_id = cc.id
      WHERE ((t.payment_method = 'money' AND strftime('%Y-%m', t.date) = ?)
         OR (t.payment_method = 'credit_card' AND t.credit_card_bill_date = ?))
         AND (t.is_deleted IS NULL OR t.is_deleted = 0)
      ORDER BY t.date ASC, t.id ASC
    `;
    const physicalTransactions = this.queryAll(sql, [month, month]);

    const recurrences = this.queryAll(`
      SELECT r.*, c.name as category_name, c.parent as category_parent, cc.name as credit_card_name 
      FROM recurrences r 
      LEFT JOIN categories c ON r.category_id = c.id 
      LEFT JOIN credit_cards cc ON r.credit_card_id = cc.id 
      WHERE r.start_date <= ? AND (r.end_date IS NULL OR r.end_date >= ?)
    `, [`${month}-31`, `${month}-01`]);
    
    const projectedTransactions = [];
    
    for (const rec of recurrences) {
      const exists = this.queryOne(`
        SELECT COUNT(*) as count 
        FROM transactions 
        WHERE recurrence_id = ? 
          AND ( (payment_method = 'money' AND strftime('%Y-%m', date) = ?) 
             OR (payment_method = 'credit_card' AND credit_card_bill_date = ?) )
      `, [rec.id, month, month]);
      
      if (exists.count === 0) {
        const [y, m] = month.split('-').map(Number);
        const startDay = new Date(rec.start_date + 'T00:00:00').getDate();
        const maxDays = new Date(y, m, 0).getDate();
        const actualDay = Math.min(startDay, maxDays);
        const dateStr = `${month}-${String(actualDay).padStart(2, '0')}`;
        
        let billDate = null;
        if (rec.payment_method === 'credit_card' && rec.credit_card_id) {
          const card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [rec.credit_card_id]);
          if (card) {
            billDate = getCreditCardBillDate(card, dateStr);
            if (billDate !== month) {
              continue; // Pula se cai em outro mês
            }
          }
        }

        projectedTransactions.push({
          id: `rec-${rec.id}`, // ID virtual
          description: rec.description,
          amount: rec.amount,
          date: dateStr,
          category_id: rec.category_id,
          type: rec.type,
          status: 'pending',
          payment_method: rec.payment_method,
          credit_card_id: rec.credit_card_id,
          credit_card_bill_date: billDate,
          recurrence_id: rec.id,
          category_name: rec.category_name,
          category_parent: rec.category_parent,
          credit_card_name: rec.credit_card_name,
          is_projected: true
        });
      }
    }

    const allTransactions = [...physicalTransactions, ...projectedTransactions];
    allTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return allTransactions;
  }

  addTransaction(body) {
    const {
      description, amount, date, category_id, type, status,
      payment_method, credit_card_id, installments, is_recurring
    } = body;

    if (amount === undefined || !date || !category_id || !type) {
      throw new Error('Campos obrigatórios: amount, date, category_id, type.');
    }

    const finalDescription = description || '';

    // Obter informações da categoria
    const category = this.queryOne('SELECT * FROM categories WHERE id = ?', [category_id]);
    if (!category) {
      throw new Error('Categoria informada não existe.');
    }

    // Cartão de crédito
    let card = null;
    if (payment_method === 'credit_card' && credit_card_id) {
      card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [credit_card_id]);
      if (!card) {
        throw new Error('Cartão de crédito informado não existe.');
      }
    }

    // CASO A: Recorrência Fixa Mensal
    if (is_recurring) {
      const recResult = this.runCommand(`
        INSERT INTO recurrences (description, amount, category_id, type, start_date, payment_method, credit_card_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        finalDescription,
        parseFloat(amount),
        parseInt(category_id),
        type,
        date,
        payment_method || 'money',
        card ? card.id : null
      ]);

      const recId = recResult.lastInsertRowid;

      let billDate = null;
      if (card) {
        billDate = getCreditCardBillDate(card, date);
      }

      const transResult = this.runCommand(`
        INSERT INTO transactions (description, amount, date, category_id, type, status, payment_method, credit_card_id, credit_card_bill_date, recurrence_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        finalDescription,
        parseFloat(amount),
        date,
        parseInt(category_id),
        type,
        status || 'realized',
        payment_method || 'money',
        card ? card.id : null,
        billDate,
        recId
      ]);

      return {
        success: true,
        recurrence_id: recId,
        transaction_id: transResult.lastInsertRowid
      };
    }

    // CASO B: Despesa Parcelada
    if (installments && parseInt(installments) > 1) {
      const totalInst = parseInt(installments);
      const baseAmount = parseFloat((amount / totalInst).toFixed(2));
      const lastAmount = parseFloat((amount - (baseAmount * (totalInst - 1))).toFixed(2));
      
      const groupId = 'group-' + Math.random().toString(36).substring(2, 15);
      const createdIds = [];

      for (let i = 1; i <= totalInst; i++) {
        const instDate = addMonths(date, i - 1);
        const instAmount = (i === totalInst) ? lastAmount : baseAmount;
        const instStatus = (i === 1) ? (status || 'realized') : 'pending';

        let instBillDate = null;
        if (card) {
          instBillDate = getCreditCardBillDate(card, instDate);
        }

        const resInsert = this.runCommand(`
          INSERT INTO transactions (description, amount, date, category_id, type, status, payment_method, credit_card_id, credit_card_bill_date, installment_group_id, installment_number, installments_total)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          `${finalDescription} (${i}/${totalInst})`,
          instAmount,
          instDate,
          parseInt(category_id),
          type,
          instStatus,
          payment_method || 'money',
          card ? card.id : null,
          instBillDate,
          groupId,
          i,
          totalInst
        ]);
        createdIds.push(resInsert.lastInsertRowid);
      }

      return {
        success: true,
        installment_group_id: groupId,
        transaction_ids: createdIds
      };
    }

    // CASO C: Transação Avulsa Padrão
    let billDate = null;
    if (card) {
      billDate = getCreditCardBillDate(card, date);
    }

    const result = this.runCommand(`
      INSERT INTO transactions (description, amount, date, category_id, type, status, payment_method, credit_card_id, credit_card_bill_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      finalDescription,
      parseFloat(amount),
      date,
      parseInt(category_id),
      type,
      status || 'realized',
      payment_method || 'money',
      card ? card.id : null,
      billDate
    ]);

    return { id: result.lastInsertRowid, ...body };
  }

  updateTransaction(body) {
    const {
      id, description, amount, date, category_id, type, status,
      payment_method, credit_card_id
    } = body;

    if (!id || amount === undefined || !date || !category_id || !type) {
      throw new Error('Campos obrigatórios: id, amount, date, category_id, type.');
    }

    let card = null;
    if (payment_method === 'credit_card' && credit_card_id) {
      card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [credit_card_id]);
    }

    let billDate = null;
    if (card) {
      billDate = getCreditCardBillDate(card, date);
    }

    const result = this.runCommand(`
      UPDATE transactions
      SET description = ?, amount = ?, date = ?, category_id = ?, type = ?, status = ?, payment_method = ?, credit_card_id = ?, credit_card_bill_date = ?
      WHERE id = ?
    `, [
      description || '',
      parseFloat(amount),
      date,
      parseInt(category_id),
      type,
      status || 'realized',
      payment_method || 'money',
      card ? card.id : null,
      billDate,
      parseInt(id)
    ]);

    return { success: result.changes > 0 };
  }

  deleteTransaction(id) {
    if (!id) {
      throw new Error('ID é obrigatório para exclusão.');
    }

    if (String(id).startsWith('rec-')) {
      throw new Error('Não é possível deletar uma projeção virtual direta. Remova a recorrência original.');
    }

    const trans = this.queryOne('SELECT * FROM transactions WHERE id = ?', [parseInt(id)]);
    if (trans && trans.recurrence_id) {
      // Soft delete para recorrências
      const result = this.runCommand('UPDATE transactions SET is_deleted = 1 WHERE id = ?', [parseInt(id)]);
      return { success: result.changes > 0 };
    } else {
      // Hard delete para transações normais
      const result = this.runCommand('DELETE FROM transactions WHERE id = ?', [parseInt(id)]);
      return { success: result.changes > 0 };
    }
  }

  getInstallmentsSummary(groupId) {
    if (!groupId) {
      throw new Error('Parâmetro group_id é obrigatório.');
    }
    
    const installments = this.queryAll(`
      SELECT id, description, amount, date, status, credit_card_bill_date, installment_number, installments_total
      FROM transactions
      WHERE installment_group_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
      ORDER BY installment_number ASC
    `, [groupId]);
    
    if (installments.length === 0) {
      throw new Error('Grupo de parcelamento não encontrado.');
    }
    
    let totalAmount = 0;
    let paidAmount = 0;
    let pendingAmount = 0;
    
    for (const inst of installments) {
      totalAmount += inst.amount;
      if (inst.status === 'realized') {
        paidAmount += inst.amount;
      } else {
        pendingAmount += inst.amount;
      }
    }
    
    return {
      groupId,
      totalAmount,
      paidAmount,
      pendingAmount,
      installments
    };
  }

  realizeTransaction(body) {
    const { id, recurrence_id, date } = body;

    if (id && !String(id).startsWith('rec-')) {
      const result = this.runCommand("UPDATE transactions SET status = 'realized' WHERE id = ?", [parseInt(id)]);
      return { success: result.changes > 0 };
    } else if (recurrence_id && date) {
      const rec = this.queryOne('SELECT * FROM recurrences WHERE id = ?', [parseInt(recurrence_id)]);
      if (!rec) {
        throw new Error('Recorrência não encontrada.');
      }

      let billDate = null;
      if (rec.payment_method === 'credit_card' && rec.credit_card_id) {
        const card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [rec.credit_card_id]);
        if (card) {
          billDate = getCreditCardBillDate(card, date);
        }
      }

      const result = this.runCommand(`
        INSERT INTO transactions (description, amount, date, category_id, type, status, payment_method, credit_card_id, credit_card_bill_date, recurrence_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        rec.description,
        rec.amount,
        date,
        rec.category_id,
        rec.type,
        'realized',
        rec.payment_method,
        rec.credit_card_id,
        billDate,
        rec.id
      ]);

      return { success: true, transaction_id: result.lastInsertRowid };
    } else {
      throw new Error('Informe o id físico ou o recurrence_id + date.');
    }
  }

  // 4. Planejamento (Budgets)
  getBudgets(month) {
    if (!month) {
      throw new Error('Parâmetro month (YYYY-MM) é obrigatório.');
    }
    
    const sql = `
      SELECT 
        COALESCE(b_curr.id, b_rec.id) as id,
        c.id as category_id,
        COALESCE(b_curr.month, ?) as month,
        COALESCE(b_curr.amount, b_rec.amount) as amount,
        COALESCE(b_curr.is_recurring, b_rec.is_recurring, 0) as is_recurring,
        c.name as category_name,
        c.parent as category_parent
      FROM categories c
      LEFT JOIN budgets b_curr ON c.id = b_curr.category_id AND b_curr.month = ?
      LEFT JOIN budgets b_rec ON b_rec.id = (
          SELECT id FROM budgets 
          WHERE category_id = c.id 
            AND month < ? 
            AND is_recurring = 1 
          ORDER BY month DESC 
          LIMIT 1
      )
      WHERE c.type = 'expense'
        AND (b_curr.id IS NOT NULL OR b_rec.id IS NOT NULL)
    `;
    return this.queryAll(sql, [month, month, month]);
  }

  saveBudget(body) {
    const { category_id, month, amount, is_recurring } = body;
    if (!category_id || !month || amount === undefined) {
      throw new Error('Campos obrigatórios: category_id, month, amount.');
    }

    const result = this.runCommand(`
      INSERT INTO budgets (category_id, month, amount, is_recurring)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category_id, month) DO UPDATE SET 
        amount = excluded.amount,
        is_recurring = excluded.is_recurring
    `, [parseInt(category_id), month, parseFloat(amount), is_recurring ? 1 : 0]);

    return { success: true, id: result.lastInsertRowid };
  }

  // 5. Recorrências
  getRecurrences() {
    return this.queryAll(`
      SELECT r.*, c.name as category_name, cc.name as credit_card_name 
      FROM recurrences r
      LEFT JOIN categories c ON r.category_id = c.id
      LEFT JOIN credit_cards cc ON r.credit_card_id = cc.id
      ORDER BY r.id DESC
    `);
  }

  getRecurrence(id) {
    return this.queryOne('SELECT * FROM recurrences WHERE id = ?', [parseInt(id)]);
  }

  deleteRecurrence(id, month) {
    if (!id) {
      throw new Error('ID é obrigatório.');
    }

    const recurrenceId = parseInt(id);

    if (month) {
      const rec = this.queryOne('SELECT * FROM recurrences WHERE id = ?', [recurrenceId]);
      if (!rec) {
        throw new Error('Recorrência não encontrada.');
      }

      const originalStartMonth = rec.start_date.substring(0, 7);
      if (originalStartMonth >= month) {
        // Se iniciou neste mês ou depois, deleta tudo
        this.runCommand('DELETE FROM transactions WHERE recurrence_id = ? AND status = ?', [recurrenceId, 'pending']);
        this.runCommand('UPDATE transactions SET recurrence_id = NULL WHERE recurrence_id = ?', [recurrenceId]);
        const result = this.runCommand('DELETE FROM recurrences WHERE id = ?', [recurrenceId]);
        return { success: result.changes > 0 };
      } else {
        // Parar a partir deste mês (definindo end_date no mês anterior)
        const [year, m] = month.split('-').map(Number);
        const lastDayPrevMonth = new Date(year, m - 1, 0).getDate();
        const prevMonth = m - 1 === 0 ? 12 : m - 1;
        const prevYear = m - 1 === 0 ? year - 1 : year;
        const endDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDayPrevMonth).padStart(2, '0')}`;

        this.runCommand('UPDATE recurrences SET end_date = ? WHERE id = ?', [endDate, recurrenceId]);

        // Deletar transações físicas pendentes associadas a esta recorrência a partir deste mês
        this.runCommand("DELETE FROM transactions WHERE recurrence_id = ? AND strftime('%Y-%m', date) >= ? AND status = 'pending'", [recurrenceId, month]);
        
        // Remover vínculo (recurrence_id = null) de transações realizadas a partir deste mês
        this.runCommand("UPDATE transactions SET recurrence_id = NULL WHERE recurrence_id = ? AND strftime('%Y-%m', date) >= ?", [recurrenceId, month]);

        return { success: true };
      }
    } else {
      // Deleta inteira
      this.runCommand('UPDATE transactions SET recurrence_id = NULL WHERE recurrence_id = ?', [recurrenceId]);
      const result = this.runCommand('DELETE FROM recurrences WHERE id = ?', [recurrenceId]);
      return { success: result.changes > 0 };
    }
  }

  updateRecurrence(body) {
    const {
      id, month, description, amount, category_id, type,
      payment_method, credit_card_id, date
    } = body;

    if (!id || !month || amount === undefined || !category_id || !type || !date) {
      throw new Error('Campos obrigatórios: id, month, amount, category_id, type, date.');
    }

    const originalRec = this.queryOne('SELECT * FROM recurrences WHERE id = ?', [parseInt(id)]);
    if (!originalRec) {
      throw new Error('Recorrência não encontrada.');
    }

    const originalStartMonth = originalRec.start_date.substring(0, 7);
    if (originalStartMonth >= month) {
      // Atualiza in-place
      this.runCommand(`
        UPDATE recurrences
        SET description = ?, amount = ?, category_id = ?, type = ?, payment_method = ?, credit_card_id = ?, start_date = ?
        WHERE id = ?
      `, [
        description || '',
        parseFloat(amount),
        parseInt(category_id),
        type,
        payment_method || 'money',
        credit_card_id ? parseInt(credit_card_id) : null,
        date,
        originalRec.id
      ]);

      let card = null;
      if (payment_method === 'credit_card' && credit_card_id) {
        card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [parseInt(credit_card_id)]);
      }
      let billDate = null;
      if (card) {
        billDate = getCreditCardBillDate(card, date);
      }

      this.runCommand(`
        UPDATE transactions
        SET description = ?, amount = ?, category_id = ?, type = ?, payment_method = ?, credit_card_id = ?, credit_card_bill_date = ?
        WHERE recurrence_id = ? AND strftime('%Y-%m', date) = ?
      `, [
        description || '',
        parseFloat(amount),
        parseInt(category_id),
        type,
        payment_method || 'money',
        credit_card_id ? parseInt(credit_card_id) : null,
        billDate,
        originalRec.id,
        month
      ]);

      return { success: true, recurrence_id: originalRec.id };
    } else {
      // Dividir (split)
      const [year, m] = month.split('-').map(Number);
      const lastDayPrevMonth = new Date(year, m - 1, 0).getDate();
      const prevMonth = m - 1 === 0 ? 12 : m - 1;
      const prevYear = m - 1 === 0 ? year - 1 : year;
      const endDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDayPrevMonth).padStart(2, '0')}`;

      this.runCommand('UPDATE recurrences SET end_date = ? WHERE id = ?', [endDate, originalRec.id]);

      const insertResult = this.runCommand(`
        INSERT INTO recurrences (description, amount, category_id, type, start_date, payment_method, credit_card_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        description || '',
        parseFloat(amount),
        parseInt(category_id),
        type,
        date,
        payment_method || 'money',
        credit_card_id ? parseInt(credit_card_id) : null
      ]);

      const newRecId = insertResult.lastInsertRowid;

      let card = null;
      if (payment_method === 'credit_card' && credit_card_id) {
        card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [parseInt(credit_card_id)]);
      }
      let billDate = null;
      if (card) {
        billDate = getCreditCardBillDate(card, date);
      }

      this.runCommand(`
        UPDATE transactions
        SET recurrence_id = ?, description = ?, amount = ?, category_id = ?, type = ?, payment_method = ?, credit_card_id = ?, credit_card_bill_date = ?
        WHERE recurrence_id = ? AND strftime('%Y-%m', date) = ?
      `, [
        newRecId,
        description || '',
        parseFloat(amount),
        parseInt(category_id),
        type,
        payment_method || 'money',
        credit_card_id ? parseInt(credit_card_id) : null,
        billDate,
        originalRec.id,
        month
      ]);

      this.runCommand(`
        UPDATE transactions
        SET recurrence_id = ?
        WHERE recurrence_id = ? AND strftime('%Y-%m', date) > ?
      `, [newRecId, originalRec.id, month]);

      return { success: true, recurrence_id: newRecId };
    }
  }

  // 6. Dashboard Estatísticas (Consolidado)
  getDashboard(month) {
    if (!month) {
      throw new Error('Parâmetro month (YYYY-MM) é obrigatório.');
    }

    const transactions = this.queryAll(`
      SELECT t.*, c.name as category_name, c.parent as category_parent, cc.name as credit_card_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN credit_cards cc ON t.credit_card_id = cc.id
      WHERE ((t.payment_method = 'money' AND strftime('%Y-%m', t.date) = ?)
         OR (t.payment_method = 'credit_card' AND t.credit_card_bill_date = ?))
         AND (t.is_deleted IS NULL OR t.is_deleted = 0)
    `, [month, month]);

    let realizedIncome = 0.0;
    let pendingIncome = 0.0;
    let realizedExpense = 0.0;
    let pendingExpense = 0.0;
    let creditCardTotal = 0.0;

    const categoryExpenses = {};
    const categoryIncomes = {};

    for (const t of transactions) {
      const amt = t.amount;
      if (t.type === 'income') {
        if (t.status === 'realized') realizedIncome += amt;
        else pendingIncome += amt;

        const cat = t.category_parent || t.category_name || 'Outros';
        categoryIncomes[cat] = (categoryIncomes[cat] || 0) + amt;
      } else {
        if (t.status === 'realized') realizedExpense += amt;
        else pendingExpense += amt;

        if (t.payment_method === 'credit_card') {
          creditCardTotal += amt;
        }

        const cat = t.category_parent || t.category_name || 'Outros';
        categoryExpenses[cat] = (categoryExpenses[cat] || 0) + amt;
      }
    }

    // Processar recorrências projetadas
    const recurrences = this.queryAll(`
      SELECT r.*, c.name as category_name, c.parent as category_parent, cc.name as credit_card_name 
      FROM recurrences r 
      LEFT JOIN categories c ON r.category_id = c.id
      LEFT JOIN credit_cards cc ON r.credit_card_id = cc.id
      WHERE r.start_date <= ? AND (r.end_date IS NULL OR r.end_date >= ?)
    `, [`${month}-31`, `${month}-01`]);

    for (const rec of recurrences) {
      const exists = this.queryOne(`
        SELECT COUNT(*) as count 
        FROM transactions 
        WHERE recurrence_id = ? 
          AND ( (payment_method = 'money' AND strftime('%Y-%m', date) = ?) 
             OR (payment_method = 'credit_card' AND credit_card_bill_date = ?) )
      `, [rec.id, month, month]);

      if (exists.count === 0) {
        let targetMonth = month;
        if (rec.payment_method === 'credit_card' && rec.credit_card_id) {
          const card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [rec.credit_card_id]);
          if (card) {
            const [yVal, mVal] = month.split('-').map(Number);
            const startDay = new Date(rec.start_date + 'T00:00:00').getDate();
            const maxDays = new Date(yVal, mVal, 0).getDate();
            const actualDay = Math.min(startDay, maxDays);
            const projectedDate = `${month}-${String(actualDay).padStart(2, '0')}`;
            targetMonth = getCreditCardBillDate(card, projectedDate);
            if (targetMonth !== month) continue;
          }
        }

        const amt = rec.amount;
        if (rec.type === 'income') {
          pendingIncome += amt;
          const cat = rec.category_parent || rec.category_name || 'Outros';
          categoryIncomes[cat] = (categoryIncomes[cat] || 0) + amt;
        } else {
          pendingExpense += amt;
          if (rec.payment_method === 'credit_card') {
            creditCardTotal += amt;
          }
          const cat = rec.category_parent || rec.category_name || 'Outros';
          categoryExpenses[cat] = (categoryExpenses[cat] || 0) + amt;
        }
      }
    }

    const balanceRealized = realizedIncome - realizedExpense;
    const balanceProjected = (realizedIncome + pendingIncome) - (realizedExpense + pendingExpense);

    return {
      month,
      totals: {
        realizedIncome,
        pendingIncome,
        totalIncome: realizedIncome + pendingIncome,
        realizedExpense,
        pendingExpense,
        totalExpense: realizedExpense + pendingExpense,
        creditCardTotal,
        balanceRealized,
        balanceProjected
      },
      categoryExpenses: Object.keys(categoryExpenses).map(name => ({ name, value: categoryExpenses[name] })),
      categoryIncomes: Object.keys(categoryIncomes).map(name => ({ name, value: categoryIncomes[name] }))
    };
  }

  // 7. Relatório Anual
  getAnnualReport(year) {
    if (!year) {
      throw new Error('Parâmetro year (YYYY) é obrigatório.');
    }

    const monthlyData = {};
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;
      monthlyData[monthStr] = {
        month: monthStr,
        realizedIncome: 0.0,
        pendingIncome: 0.0,
        realizedExpense: 0.0,
        pendingExpense: 0.0,
        totalIncome: 0.0,
        totalExpense: 0.0,
        balanceRealized: 0.0,
        balanceTotal: 0.0
      };
    }

    const transactions = this.queryAll(`
      SELECT type, status, amount, date, payment_method, credit_card_bill_date
      FROM transactions
      WHERE ((payment_method = 'money' AND strftime('%Y', date) = ?)
         OR (payment_method = 'credit_card' AND substr(credit_card_bill_date, 1, 4) = ?))
         AND (is_deleted IS NULL OR is_deleted = 0)
    `, [year, year]);

    for (const t of transactions) {
      const refMonth = t.payment_method === 'credit_card' ? t.credit_card_bill_date : t.date.substring(0, 7);
      
      if (monthlyData[refMonth]) {
        const amount = t.amount;
        if (t.type === 'income') {
          if (t.status === 'realized') {
            monthlyData[refMonth].realizedIncome += amount;
          } else {
            monthlyData[refMonth].pendingIncome += amount;
          }
        } else {
          if (t.status === 'realized') {
            monthlyData[refMonth].realizedExpense += amount;
          } else {
            monthlyData[refMonth].pendingExpense += amount;
          }
        }
      }
    }

    const recurrences = this.queryAll(`
      SELECT id, amount, type, start_date, end_date, payment_method, credit_card_id
      FROM recurrences
      WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)
    `, [`${year}-12-31`, `${year}-01-01`]);

    for (let m = 1; m <= 12; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;
      
      for (const rec of recurrences) {
        if (rec.start_date.substring(0, 7) <= monthStr && (!rec.end_date || rec.end_date.substring(0, 7) >= monthStr)) {
          let targetMonth = monthStr;
          if (rec.payment_method === 'credit_card' && rec.credit_card_id) {
            const card = this.queryOne('SELECT * FROM credit_cards WHERE id = ?', [rec.credit_card_id]);
            if (card) {
              const [yVal, mVal] = monthStr.split('-').map(Number);
              const startDay = new Date(rec.start_date + 'T00:00:00').getDate();
              const maxDays = new Date(yVal, mVal, 0).getDate();
              const actualDay = Math.min(startDay, maxDays);
              const projectedDate = `${monthStr}-${String(actualDay).padStart(2, '0')}`;
              targetMonth = getCreditCardBillDate(card, projectedDate);
              
              if (targetMonth.substring(0, 4) !== year) {
                continue;
              }
            }
          }

          if (monthlyData[targetMonth]) {
            const exists = this.queryOne(`
              SELECT COUNT(*) as count 
              FROM transactions 
              WHERE recurrence_id = ? 
                AND ( (payment_method = 'money' AND strftime('%Y-%m', date) = ?) 
                   OR (payment_method = 'credit_card' AND credit_card_bill_date = ?) )
            `, [rec.id, targetMonth, targetMonth]);

            if (exists.count === 0) {
              if (rec.type === 'income') {
                monthlyData[targetMonth].pendingIncome += rec.amount;
              } else {
                monthlyData[targetMonth].pendingExpense += rec.amount;
              }
            }
          }
        }
      }
    }

    const resultList = [];
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;
      const d = monthlyData[monthStr];
      
      d.totalIncome = d.realizedIncome + d.pendingIncome;
      d.totalExpense = d.realizedExpense + d.pendingExpense;
      d.balanceRealized = d.realizedIncome - d.realizedExpense;
      d.balanceTotal = d.totalIncome - d.totalExpense;
      
      resultList.push(d);
    }

    return resultList;
  }
}

// Expor globalmente para simplificar carregamento sem módulos em app.js tradicional
window.LocalDBEngine = LocalDBEngine;
