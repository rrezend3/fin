/**
 * Servidor de integração com o Google Drive API (v3) usando Google Identity Services.
 */

class GoogleDriveService {
  constructor() {
    this.clientId = localStorage.getItem('fin_google_client_id') || '';
    this.accessToken = sessionStorage.getItem('fin_google_access_token') || '';
    this.tokenExpiry = parseInt(sessionStorage.getItem('fin_google_token_expiry') || '0');
    this.fileId = localStorage.getItem('fin_google_file_id') || '';
    this.tokenClient = null;
    this.onAuthChange = null; // Callback para alertar o app sobre status de login
  }

  setClientId(clientId) {
    this.clientId = clientId;
    localStorage.setItem('fin_google_client_id', clientId);
    this.tokenClient = null; // Força recriação do cliente com o novo ID
  }

  setFileId(fileId) {
    this.fileId = fileId;
    localStorage.setItem('fin_google_file_id', fileId);
  }

  isAuthorized() {
    if (!this.accessToken) return false;
    const now = Date.now();
    return now < this.tokenExpiry;
  }

  /**
   * Inicializa o cliente Google Identity Services
   */
  initTokenClient() {
    if (!this.clientId) {
      throw new Error('Google Client ID não configurado.');
    }
    if (this.tokenClient) return;

    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      throw new Error('Biblioteca Google API (gsi) não foi carregada.');
    }

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: 'https://www.googleapis.com/auth/drive email profile', // Acesso completo e dados do usuário
      callback: (response) => {
        if (response.error) {
          console.error('Erro na autenticação do Google:', response.error);
          return;
        }
        
        this.accessToken = response.access_token;
        // Salva expiração (tempo de agora + segundos recebidos - margem de 5 min)
        const expiryTime = Date.now() + (parseInt(response.expires_in) - 300) * 1000;
        this.tokenExpiry = expiryTime;

        sessionStorage.setItem('fin_google_access_token', this.accessToken);
        sessionStorage.setItem('fin_google_token_expiry', expiryTime.toString());

        if (this.onAuthChange) {
          this.onAuthChange(true);
        }
      }
    });
  }

  /**
   * Dispara a tela de Login/Autorização da Google
   */
  login() {
    this.initTokenClient();
    // Solicita o token de acesso de forma interativa
    this.tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  /**
   * Efetua logout limpando os tokens da sessão
   */
  logout() {
    this.accessToken = '';
    this.tokenExpiry = 0;
    this.fileId = '';
    sessionStorage.removeItem('fin_google_access_token');
    sessionStorage.removeItem('fin_google_token_expiry');
    localStorage.removeItem('fin_google_file_id');
    
    if (this.onAuthChange) {
      this.onAuthChange(false);
    }
  }

  /**
   * Busca pelo arquivo 'finance.db' no Google Drive
   */
  async findDatabaseFile() {
    if (!this.isAuthorized()) throw new Error('Não autorizado no Google Drive.');

    const url = `https://www.googleapis.com/drive/v3/files?q=name='finance.db'+and+trashed=false&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime+desc`;
    
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.logout();
      }
      throw new Error('Falha ao procurar arquivo no Google Drive: ' + res.statusText);
    }

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      const file = data.files[0];
      this.setFileId(file.id);
      return file;
    }
    
    return null;
  }

  /**
   * Faz o download do banco de dados como ArrayBuffer
   */
  async downloadDatabaseFile(fileId = this.fileId) {
    if (!this.isAuthorized()) throw new Error('Não autorizado no Google Drive.');
    if (!fileId) throw new Error('Nenhum arquivo ID informado.');

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.logout();
      }
      throw new Error('Falha ao baixar banco de dados do Google Drive: ' + res.statusText);
    }

    return await res.arrayBuffer();
  }

  /**
   * Faz upload de um NOVO arquivo 'finance.db' (caso não exista no Drive)
   */
  async uploadDatabaseFile(content) {
    if (!this.isAuthorized()) throw new Error('Não autorizado no Google Drive.');

    const metadata = {
      name: 'finance.db',
      mimeType: 'application/x-sqlite3',
      description: 'Banco de dados do PWA de Finanças Pessoais'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: 'application/x-sqlite3' }));

    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      },
      body: form
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.logout();
      }
      throw new Error('Falha ao criar arquivo no Google Drive: ' + res.statusText);
    }

    const data = await res.json();
    this.setFileId(data.id);
    return data.id;
  }

  /**
   * Atualiza (sobrescreve) o arquivo 'finance.db' existente no Google Drive
   */
  async updateDatabaseFile(content, fileId = this.fileId) {
    if (!this.isAuthorized()) throw new Error('Não autorizado no Google Drive.');
    if (!fileId) throw new Error('Nenhum arquivo ID cadastrado para atualização.');

    const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/x-sqlite3'
      },
      body: content // Uint8Array exportado do sql.js
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.logout();
      }
      throw new Error('Falha ao salvar alterações no Google Drive: ' + res.statusText);
    }

    return await res.json();
  }

  /**
   * Obtém informações do usuário conectado (para verificar o e-mail)
   */
  async getUserInfo() {
    if (!this.isAuthorized()) return null;
    const url = 'https://www.googleapis.com/oauth2/v3/userinfo';
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error('Erro ao buscar perfil do usuário:', err);
      return null;
    }
  }
}

// Expor globalmente no PWA
window.GoogleDriveService = GoogleDriveService;
