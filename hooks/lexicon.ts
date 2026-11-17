// More signs of each language: the words its software and manuals write most, and English never.
//
// language.ts tells a sentence's language by its signs, the commonest short words of each
// language first. These add the words each writes most beyond those: "fichier", "archivo",
// "Datei", "bestand", "configuración", "werden". A word of software is a sign as good as any in
// a reply about code, and a sentence of three or four words ("Fichier introuvable", "Archivo no
// encontrado") often has no other.
//
// Each list was drawn from the translations installed on a Linux machine (GNU gettext catalogs
// and manual pages): a language's words most used across many programs, without any word an
// English dictionary has or English text uses. Each ends with everyday words its software does
// not write ("aujourd'hui", "oggi", "gestern", "vandaag"), checked the same way. English has its own: words its interface text
// uses most that no other language writes as its own, without the English words a French or
// German sentence about code borrows (build, merge, setup), which say nothing of its language;
// and the everyday words of its prose (brought, thought, yesterday) no other language writes,
// those that are words of Dutch or German too ("want", "fast", "week") left out.
//
// Measured on manual pages kept out of the drawing: each language's sentences were told as
// that language more often (by three to seven in a hundred), English ones no more often as
// another, and no two of these languages more often taken for each other.

export const LEXICON: Readonly<Record<string, string>> = {
  // English, 586 words.
  en: `
    the not and with this from objects you cannot will number new when package used only could
    default value invalid show current size line that width please must group user paths your list
    but more one has installed character want between using found available does which length lines
    enable whether missing convert along save each specified display make should left right out
    empty allowed install command already search into copy view center edit location check warning
    packages may after while read field like load height any than some tool other apply pattern
    archive too content around write its first space try following entry created time them instead
    without screen defined supported device unknown identifier before print single align switch
    settings because replace key values automatically allow choose there where level changes
    filename requires exist required see inside different range another process two custom split
    contains run given their many previous even how been old now here numbers additional work above
    setting disable external removed need lower down characters again properties library order major
    language column icon uses next both speed least existing take removing memory about second small
    keep processing these handle below ignore back family groups request method useful allows
    creating don't short transform such also connection enabled specify always names based exists
    currently manually outside access free adds unit reading off containing modify contents manager
    application distribute case configured forms applied sure specification nothing fixed generate
    drop every contain added writing running were longer keys black encoding really property
    provides loading expected they modified changed updated less starting steps written disabled
    parse parameters then specific turn limit definition high associated stored avoid continue
    extended look function result whole wrong own initial best deprecated help directly adding
    configure sets installing dependencies tools creates put present formats needed block either
    dependency compatibility starts copying none security much languages words square determine
    defaults doesn't enough would once usually rule able exported several join yet devices report
    extract override complete otherwise matching advanced during sign correct done comment provided
    usage what plain flags ignored policy through low checking still third generated including tree
    basic main algorithm corresponding operations commands prefix large included definitions needs
    within require libraries named parsing account comments word return provide performance results
    big problems reserved together entries event just said made went got came took gave brought
    thought told knew felt saw kept began seemed asked became turned looked showed called tried
    wanted worked moved started helped meant heard ran stood held paid wrote spent say go give think
    tell find know feel seem ask become call mean hear send hold spend says makes goes gets comes
    takes gives brings thinks tells finds knows feels sees keeps seems asks looks shows calls tries
    going getting coming taking giving making thinking looking trying doing having being saying
    seeing people thing things way day days year years times woman child world company program
    government night room mother money story fact month study book eye side head house friend father
    power hour member law city community kid body others office health person history party morning
    reason research girl guy teacher education good last great little early young important few bad
    same likely clear better true full special easy strong quick quickly slow slowly happy late
    often never sometimes actually probably maybe perhaps almost quite rather though although
    however therefore neither soon ago today tonight tomorrow yesterday away toward towards upon
    whose whom ourselves themselves himself herself itself myself yourself everyone everything
    someone something anyone anything nobody twice
  `,
  // French, 683 words.
  fr: `
    fichier dans une avec sur sont nom fichiers être peut cette qui valeur comme défaut vous ligne
    chemin commande paquet utiliser taille liste données cela tous afficher mais système nombre
    groupe paquets été lors répertoire processus même peuvent objets doit erreur couleur aux texte
    utilisé utilisateur toutes sous serveur passe informations aucun mémoire exemple vers depuis
    lignes définir mot jour plusieurs supprimer sélectionner créer chaque sélection noms deux aussi
    indiquer entre veuillez valeurs seront voir faut affiche chaîne ces après filtre soit mise
    commandes jeu permet utilisant cas quand ajouter disque nouveau chemins seulement lorsque avant
    moins indique utilisée sélectionnés numéro activer niveau largeur caractère filtres aucune autre
    forme autres contrôle contient fenêtre fois partir votre toujours effet caractères contenu déjà
    ont disponibles fait elle utile dictionnaire recherche décompression décalage faire
    automatiquement ainsi compte utilisez déplacer traduction identifiant paramètre vide longueur
    utilisateurs cliquer paramètres limite fonction nouvelle objet périphérique disponible ouvrir
    pouvez spécifié doivent échec alors avoir toute couleurs adresse début dernier vérification
    quantité suivantes mio colonnes groupes existe mettre cible sélectionné indiqué partie appliquer
    définit suivant pris également référence syntaxe droite outils leur uniquement valable copie
    classe barre utilisées secondes réseau cet contenant définie prend dessus enregistrer mots
    éditer convertir actuellement boîte jeux graphique remplissage certains défini domaine obtenir
    fourni glisser bas tourner tête seule nécessaire voulez vitesse créé écran comportement requête
    choisir haut consulter désactiver suivants dernière utilisés manière automatique vidéo montrer
    retirer seul devrait espace modèle quel cours création installé trouvé rechercher chargement
    besoin quelques mises projet dessous correspondance habituellement invalide tant méthode
    attributs identique trop correspondant afin première éléments donc départ rapide détails têtes
    puis différents suffixe laquelle remplacer déplacement bien priorité résolution problème
    rationnelle celui ouvre actif donné curseur signaler problèmes façon peu attribut sinon ici ceci
    plein actuel obsolète supplémentaires selon espaces élément celle clé spécifiée média plutôt
    trouver nouveaux systèmes sens débogage rendre erreurs bogue ses outil spécifier différentes
    lequel ignorer nécessite démarre autorisés vérifier supprimé colonne formes pourcentage ajoute
    ils serveurs sauf inclure courant avertissement binaire tailles marqueur configurer symbolique
    permettre fournie signifie traitement minimale contexte résultat devez suivante insérer
    fonctionne maximale titre réinitialiser choix miroir réglages raison omis annuler réponse
    généralement taux forcer compressé lui donnée actuelle imprimer seconde elles autour valide
    retour tâche hachage bibliothèque crée exécuter normalement aléatoire souris mis certaines
    effets inconnu propriétés rendu fournit noyau niveaux contenir démarrage gestion créés état
    directement notez séparés ordre équivalent propos complet jamais langue ayant inconnue
    maintenant bogues terminer associé relatif aligner entrer marqueurs dessiner échoué zéro entier
    hôte coller chiffrement vert autoriser modifie souhaitez supprime envoyer clavier fournir
    horaire gros commentaire fixe compatibilité sécurité leurs pourrait nouvel préférences spécifie
    parce chiffres activé plupart reste auquel sauvegarde rien externe demandé quatre ceux famille
    téléchargement superutilisateur correctement qualité lancé trois beaucoup très spécifiés préfixe
    lettres plage presse stockées délai prendre verrouiller affichées désactive primaire masquer
    demande affichée manuellement avez renommer responsable souvent général nouvelles enregistrement
    mêmes meilleure accès papier éditeur produit fermer installés dépendances sélectionnez casse
    calculer commencer profil légèrement manquant arrière politique changement fonctionner durée
    sélectionnée profondeur existant quelle étiquette listes déterminer écrit affichage encodage
    principale haute trouvée activée lecteur touche complète suivi requis succès précédent ignoré
    résultats effectuer navigateur limiter séparées remplacement seuls autorisé stockage règle
    droits libre cliquez produite utilisent différence membre spécification ajoutant hors démarrer
    nécessaires conserver dur devriez garder exécutable fini statut fonctionnalité varier permis
    logiciel numéros numérique définition inclus supérieur spécifiques augmenter réel opération
    vraiment faible attente répertoires vos pilotes parallèle commentaires essayer continuer possède
    clés remplace dépend ajout séparer devient convertit était effacer périphériques choisi
    probablement corrompu avertissements opérations dupliquer mesure terminé ignorée contrôles
    drapeaux cependant respectivement particulier celles tels telles consultez aujourd'hui hier
    demain salut bonsoir bonne nuit matin soir semaine mois année heure heures jours journée ami
    amis merci désolé excusez s'il plaît d'accord bientôt parfois assez presque juste lentement
    grande petit vieux bon bons bonnes mauvais difficile heureux fatigué prêt prête suis sommes êtes
    étais avait avons vais vas allons allez vont fais faisons faites dit veux veut peux sais savez
    crois pense trouve aime voudrais faudrait quoi combien contre chez quelqu'un quelque personne
    oui
  `,
  // Spanish, 666 words.
  es: `
    una archivo puede nombre archivos mostrar fichero esta más objetos este opción usar opciones
    paquete imagen paquetes datos línea objeto texto modo página tamaño crear versión debe ser
    sistema configuración todos selección cambiar información desde abrir eliminar cada esto cuando
    seleccionados tipo entrada usuario seleccionar todas directorio número lista pero pudo muestra
    líneas documento nuevo añadir punto salida forma pantalla dirección predeterminado activar
    efecto páginas entre fallo formato tiempo sobre grupo seleccionado ventana ruta guardar nueva
    pueden tiene seleccione contraseña puntos aplicación carpeta extensión indica imágenes nombres
    buscar obtener ancho orden exportar anchura editar instalar espacio lugar existe ejecución
    fuente herramienta hacer longitud dentro ejemplo fondo inicio vez aplicar convertir cualquier
    completa derecha borrar patrón izquierda instalado están quiere enlace siguiente válido
    instalación disponible estilo elemento barra hacia elementos contenido menos búsqueda actualizar
    utiliza utilice permite ejecutar contiene vídeo estado caché estándar necesita también parte
    copia ficheros valores cargar ningún disponibles formas programa clave sus servidor usando área
    automáticamente reiniciar ubicación sonido etiqueta establecer sólo preferencias ocultar mismo
    copiar caracteres desplazamiento filtro diálogo solamente especificar introduzca campo código
    versiones otro utilizar encontrado referencia dispositivo predeterminada ahora cuenta mediante
    extensiones origen importar crea prioridad cambios desea cual soporte dependencias comando
    entorno parámetro interfaz abajo especificado inicial aviso ratón adicionales dibujar siguientes
    actualizaciones siempre velocidad ayuda posición argumento requiere algunos podido búsquedas
    después aplicaciones iniciar unidad será rango desactivar deben órdenes azul conjunto detalles
    estar registro tal píxeles falta cadena cero hace comandos escribir desconocido fuera encontrar
    arquitectura qué ninguna tipografía varios otra útil arriba localización demasiado nivel activa
    cerrar añade normalmente destino descripción argumentos seguridad acceso blanco sección segundos
    porcentaje propiedades fecha última depuración donde icono método codificación permisos
    instalada operación utilizado herramientas estos así otros varias usado descarga título mensaje
    biblioteca escritorio establece caso permitir progreso medio bloquear sesión correctamente salir
    configurar necesario ninguno actualización tienen bajo quitar definir debería mientras último
    memoria pegar otras mantener tener números falló relación escritura seleccionada encima
    reemplazar máximo problemas proceso marca captura posible elimina utilizando diferentes incluir
    acerca ejecutable desinstalar comprobar cabecera misma válida renombrar comportamiento escribe
    teclado idioma oscuro portapapeles menú carácter errores parámetros establecida mejor función
    advertencia tipos controla cambio partir partes secciones aspecto ajustes ignorar botón
    incorrecta pudieron algunas enlaces reducir igual mensajes instalados esté sintaxis suma vacío
    licencia especifica compresión cancelar respuesta incorrecto usará lectura palabra generar
    conexión inválido encuentra previa defecto familia descargar libre informe convierte calidad
    nada autenticación enviar palabras insertar resumen nuevos verificación tenga aquí serán
    plantilla antiguo espacios hasta ejecuta evitar seguro acción modificar adicional determinar aún
    consulte simbólico elija separados columnas configurado derecho gestor descripciones porque
    interno problema proporciona coincidencia referencias alternativa navegador predeterminados
    elegir mínimo activo cómo reproducción vea busca creado comprobación compatibilidad primera
    fuerza directorios letras contexto medios estas encontró continuar soporta especificada completo
    trabajo vacía entero máquina carga equipo barras actualmente usada claro distribución diferente
    grande realizar sido omitir imprimir visibles objetivo menor consola rápido dar manualmente
    tamaños junto instaladas forzar múltiples tema reciente debido expresión algoritmo desconocida
    componente límite minúsculas primero mayúsculas traducción esa limpiar marcar compilación
    resultado tanto continuación directamente incluso plano ese omisión asignar diferencia ordenar
    servicio existentes serie cuadrado identificador reproducir activado volver automática instala
    administrador nuevas muy rutas formatos combinación poner corrección único comenzar rápida
    analizar carpetas prefijo extraer cualquiera manera ambos recientes ventanas petición gestión
    hora intentar según existente significa duplicado componentes listado usan terminar sobrescribir
    conversión días minutos soportado almacenamiento admite inválida desactivado montaje registros
    funciona haya automático restaurar sistemas ello resultados guardado tendrá fue mal acciones
    contener contienen aplica opcional sitio correo pequeño solicitud nota usted mucho adecuado
    utilidades programas operaciones actualizado raíz entonces hoy ayer buenos buenas noches tardes
    semana año horas gracias perdón siento verdad quizás temprano tarde despacio juntos viejo bueno
    malo fácil difícil contento feliz cansado listo terminado eres somos estoy estás estamos tenía
    tengo tienes tenemos voy vas vamos hago hacemos digo quiero quieres puedo puedes sabes creo
    pienso encuentro gusta quisiera eso aquel cuál cuánto contra alguien nadie nunca todavía allí
    dónde cuándo
  `,
  // Italian, 669 words.
  it: `
    una essere sono dei questo più può viene valore nel questa quando delle dimensione compressione
    gli impossibile versione opzioni livello tracciato memoria modalità anche colore dati
    predefinito stato modo alla filtri mostra comando usare errore filtro nella pacchetto
    informazioni formato testo dal imposta esempio pacchetti tutti sistema ogni modifica pagina tipo
    opzione vengono configurazione seleziona possono finestra indica senza deve tra selezione tutte
    dizionario prima posizione sul crea controllo sia usato specificato larghezza impostazioni
    effetto cui limite dopo gruppo caratteri oggetto livelli possibile blocco carattere nessun
    predefinita dimensioni utilizzo potrebbe dalla vedere utilizzato quindi nuovo degli immagine
    riempimento punto valori usando documento copia selezionato immagini sarà singola nomi pagine
    supporto utilizzare manuale linea meno specificare utile nelle linee impostare versioni
    specifica percorso stampa rapporto abilita stesso eseguire quantità sorgente altri specificata
    parte creare dello strumento sempre velocità ancora alcuni righe compresso clic grande verrà
    rimuovi automaticamente molto nuova terminale primo attuale destinazione già attiva lunghezza
    inizia invece programma collegamento contiene altre intero apri perché comandi questi richiede
    rotazione lista punti blocchi cartella colonne flusso iniziale utente aggiungi ricerca spazio
    modificare disponibili schermo nei aiuto messaggio esiste nessuna oppure disponibile alle volte
    sullo alcun seguenti qualsiasi apre usata argomento suffisso queste caso salva migliore valido
    argomenti stata stringa impostato installato stati lungo corrente dispositivo altro almeno
    supportato saranno lavoro richiesta codice errori campo destra rimuovere regolare diversi
    massimo necessario aggiunge originale hanno precedente sinistra inserisci sfondo sotto
    selezionare secondo suo quello cerca proprietà intestazioni estensione cursore elenco visualizza
    metodo problemi centro rimosso ottenere verticale titolo orizzontale minimo applica dettagli
    elimina leggermente corrispondenze totale utilizzando successo supporta eseguito altezza
    contenuto elemento riuscita dovrebbe sistemi fino sopra integrità troppo trovare controlla
    direzione verranno trovato rimuove percentuale forma dipendenze voce avere abilitare aggiungere
    esce evitare insieme funziona quale sta uscita automatico preferenze seguente ulteriori dai
    aprire quella provare variabile rende termina fatto archivio barra lettura alcune numeri
    reimposta attualmente inferiore presente modello singolo nello funzionalità estensioni massima
    ordine chiave impostazione tutto bordi problema comunque impostata secondi inserire equivalente
    scelta superiore accetta valida nota aggiornamenti supportati loro sezione tastiera
    visualizzazione creati colonna disattiva messaggi modifiche binario quanto comportamento
    contenuti veloce avviso sintassi risoluzione visualizzare relativo distanza strumenti
    distribuzione creazione utilizzata ultimo eseguibile sugli leggere parti seguito effetti gruppi
    utenti devono nuovi vuoto mentre dallo permette usati ciò allineamento funzione avanzamento
    stessa elementi dalle parametro salvare possibili lettere attributi forza negli normale maggior
    passare personalizzata caricamento mostrare controlli sulle proprio interno libreria compatibile
    origine scrive successivo rispetto grezzi impostando nascondi cambiare determinare programmi
    corrispondenza solamente recente verificato selezionata accesso semplice momento dato
    selezionate scrivere cosa scrittura converte importa codifica risultato ridimensionamento
    formati specifico attivo causa potrebbero virgole descrizione installati presenti ignorato
    utilizza poiché separati creato altrimenti agli esecuzione utilizzate verifica qui lento trova
    alti scorrimento sconosciuto tasto quattro contesto ignora visibile richiesto mancante incolla
    nessuno manca lingua tramite carica posto relativi connettersi installare aggiornamento
    correttamente completo spazi separato lettera fondo significa appunti processo sicurezza
    installa necessaria occorre traccia cancella parametri adatta calcola rilascio mostrato
    disabilita manualmente direttamente siano precedenti contenente variare normalmente finestre
    scaricamento fuori trovata usano eliminare rimozione senso predefiniti supportano principale
    avvia aggiorna mantenere riferimento solitamente differenza annulla specifiche descrizioni
    installata così predefinite metadati combinazione ingresso albero applicazioni sconosciuta
    automatica simbolico variabili contengono tuo personalizzate aggiunto utilizzati sua attenzione
    componente tre scuro verso orientamento quelli consente riproduzione uguale grado elenca invio
    gestione scegliere conversione allo prefisso meglio ridurre personalizzato ripristina dialogo
    caricare esegue oltre scritti alternativa lingue completa maiuscole esistenti testi quali
    globale collegato disabilitato vecchi fornisce risultati probabilmente vecchio canale percorsi
    vari aumenta simili misura finali indietro etichetta maggiore controllare esistente rinomina
    positivo bene spesso solito qualche buona casi notare oggi ieri domani adesso buongiorno
    buonasera buonanotte notte mattina settimana anno minuti giorni amico amica amici grazie prego
    scusa scusi favore certo davvero forse tardi buono cattivo difficile contento stanco finito sei
    siamo siete ero avevo hai abbiamo avete vado vai andiamo andate vanno faccio facciamo dico
    voglio vuoi posso puoi sai penso trovo piace vorrei dovrei contro qualcuno stai sto stiamo
  `,
  // Portuguese, 667 words.
  pt: `
    não ser arquivo pode ficheiro mais caminho padrão pacote foi são linha arquivos tamanho possível
    pacotes sistema usar esta cor opções apenas ficheiros erro opção este modo número texto quando
    todos versão imagem sem usado saída formato deve lista você das página criar comando entrada
    grupo definir camada limite mostra nenhum utilizador fonte pelo configuração podem memória mesmo
    cada todas isso exemplo tipo linhas tem especificado isto usando largura abrir será documento
    seu vez especifica filtro preenchimento caminhos novo entre valores efeito alterar definido
    também objetos páginas ponto objeto mostrar tela menos adicionar directório sobre qualquer nós
    predefinição comandos nomes suporte serão obter imagens fazer informações configura pré fontes
    área partir desde atual diretório janela campo informação filtros sua usada pontos seleção
    deslocamento inválido extensão traço usuário ajustar falhou seja falha forma instalado
    automaticamente qual estiver veja caixa palavra escala ambiente aplicar nenhuma estado aviso
    ajuda seleccionar configurações alguns após muito programa selecionar ferramenta trabalho editar
    pela selecionado nível caso espaço ainda altura seguintes estão existe onde estilo outros irá
    remoto dicionário selecção instalar comprimento instalação destino sempre visualização controle
    quantidade permite gravar disponível descompactar dois verificação chave longo operação
    caracteres outro primeiro velocidade contém selecione processo faz disponíveis mensagem baixo
    dentro dispositivo fundo alternar devem selecionados variável argumento segurança descompactação
    máximo deseja senha maior exibir executar impressora centro instalados atributo várias
    diferentes conteúdo impressão inicial detalhes exibe útil origem versões essa melhor passe acima
    compactado geralmente fluxo argumentos direita precisa adiciona código definida parte copiar
    foram ter incapaz permitir posição projeto habilitar tipos bordas única localização fim carregar
    aos normalmente cria barra cabeçalho prioridade importar metadados ordem vídeo único extensões
    predefinido mudar colunas bloco porque assim enquanto agora ler nas especificada inserir
    especificar requer última último conjunto vezes esquerda usados removido erros atualizações
    outras numa acesso até alinhamento substituir necessário servidor salvar grupos escrever método
    encontrado codificação inteiro formas informa problemas ele instala conta seus mínimo
    ferramentas iniciar mensagens distância abaixo tente partes desenhar duas aplicativo suportados
    vários início esse predefinições áudio inválida sintaxe impossível procurar mapa repositório
    estar escolha segundos pois deste caractere portanto suportado mesma sistemas processos
    desconhecido eles integridade sufixo simples fornecido coluna tornar manter nunca tudo verificar
    aplicação pesquisa máscara vai usadas novos unidade imprime rodar atualização execução interno
    resultado programas cópia alterações atualizar alternativa problema têm cima guardar atributos
    definição seguinte taxa descrição sucesso horário efeitos somente encontrar procura números
    ícones guia activar parâmetro transferência excluir criado branco idioma correspondência ecrã
    verifica modelo ocultar ignorar suas ícone máquina graus elemento depuração propriedades
    permissões outra vazio automático sentido possui aqui menor significa forem modos depois meio
    resultados blocos proporção unidades tiver eliminar autenticação tabela sido adicionais devido
    biblioteca novamente instalada raiz suporta existir banco fechar restaurar compressão nada
    utilizar pouco faixa nota antigo falta então tenha sai diferente recurso evitar ajuste controlo
    necessária letras altera serem tentar algumas profundidade configurar neste livre existem
    escrita cabeçalhos localizar aumentar classe formatos dependências feito grande conter
    alternativo resolução colar imprimir botão atualmente tamanhos pedido ligação família
    manualmente preferências primeira inverter vazia lado equivalente palavras itens separados
    descompactado seguir leitura comportamento sinal arquitectura serviço diálogo marcador quaisquer
    definições renomear utilização função relativo escolher especificados arquitetura recente
    espaços aplicações intervalo criados alvo cópias contrário avisos ocorreu completo consulte
    quanto força título maiúsculas captura reduzir ativar tal incluindo sair analisar esses quais
    membro contexto encontrada teste incluir predefinida topo sejam configurado relação executável
    registo continuar progresso expressão disso defina lento corrompido próximo compatibilidade
    marca desconhecida digite seção assinatura sessão máxima sendo possíveis usuários maioria indica
    desta mídia válido enviar listar fornecer média bloquear corresponder correr pesquisar padrões
    teclado compilação suficiente anteriores hoje ontem amanhã bom dia tarde noite manhã semana ano
    hora horas minutos dias obrigado obrigada desculpa desculpe claro verdade talvez cedo devagar
    juntos sozinho pequeno velho mau fácil difícil contente feliz cansado terminado sou somos estou
    estás estamos tinha tenho temos vou vais vamos vão faço fazemos digo diz quero queres posso
    podes sei sabes acho penso encontro gosto gostaria deveria aquilo contra alguém ninguém vocês
  `,
  // German, 669 words.
  de: `
    der und werden wird nicht von das für sie eine auf datei ein kann wenn als diese aus dateien
    sind nur zum dass einer keine alle bei optionen nach einem wie durch einen verwendet wert wurde
    angegeben sein können zur verwenden auch gibt verzeichnis größe beim gesetzt aber modus paket
    sich dieser fehler benutzer pfad befehl anzahl legt anzeigen kein zeigt informationen ausgabe
    pakete eines setzen kompression objekte daten siehe gruppe liste beispiel unterstützt namen
    entfernt programm entfernen benutzt ohne anderen installiert dann ebene bitte mehr zeile seit
    über dieses soll zeichen vor setzt ändern vorgabe auswahl konnte werte noch folgenden zwischen
    bereits angezeigt neue erlaubt mehrere objekt unter haben enthält dateiname wurden beendet
    angegebenen bis vom benötigt öffnen erstellen gefunden erstellt lesen andere außer sollte
    auswählen daher farbe automatisch passwort breite einstellungen hinzufügen möglich diesen feld
    aktivieren einige seite löschen zwei selbst welche aktiviert verwendung erzeugen erzeugt zeit
    diesem enthalten standardausgabe versionen speichern standardmäßig bearbeiten dateinamen hilfe
    aktuellen angegebene weitere ignoriert wählen neuen dokument verschieben müssen verfügbar könnte
    beachten bild fehlgeschlagen existiert jede archiv konfigurationsdatei aktuelle geschrieben
    eingabe voreinstellung fenster schreiben immer gespeichert sollen deren geben begrenzung ziehen
    pfade zeilen erweiterung gleichen warnung typ ende prozess skript unten sekunden ziel benutzen
    befehle definiert deaktiviert etwas vorhanden speicher bedeutet ausgeführt installieren inhalt
    sollten befehlszeile attribut wobei zeichenkette ausrichtung darf jeder spalten erhalten
    benutzers folgende ausgewählt mittels datenbank entweder während gewählten versuchen teil
    beenden erste seiten neu ausdruck abschnitt ersten ihre zusammen handbuchseiten bereich ihr
    titel indem finden viele wörterbuch zurücksetzen hinweis ausgewählte ungültige aufruf größer
    länge ordner damit festlegen veraltet wollen zahl mindestens ort oben startet verschiedene
    unterstützung umwandeln anwendung stattdessen angeben hinzu fügt suchen jedoch argumente gruppen
    anstatt versatz nützlich normalerweise komprimiert architektur groß kopieren quelle funktioniert
    keinen bilder klicken benutzername leerzeichen pakets paketen änderungen gelesen jedes
    geschwindigkeit denen passt gelöscht neuer farben akzeptiert angabe anwenden nummer abstand
    sowie erfolgreich letzte konfiguration deaktivieren derzeit ausgeben kennung getrennt
    erweiterungen standardeingabe hinzugefügt geändert quelldatei sehr verschiedenen geöffnet
    maximale einfügen rechts unterstützen einzelnen ansicht methode neues kopiert standardwert
    starten anpassen zusätzliche bestimmte meldungen spalte zeichnen alles aktion ausführbare weil
    ungültiger innerhalb erlauben aktualisiert ersetzen gerät teile adresse konfiguriert wählt
    sowohl erforderlich anwendungen fehlermeldung umgebungsvariablen relativ menge linien
    benutzerdefinierte hier ausgewählten effekt eintrag vorgegebene anzeige besser funktion würde
    aktualisieren zuletzt versucht punkt zurück gewählte weiter paketname handbuchseite ganzzahl
    beginnen möchten priorität gleiche aktionen anstelle bestimmt aller ihrer stil beschreibung
    ersetzt metadaten bestimmen entspricht einzelne gestartet verhalten getrennte referenz
    verbindung ausführen gegenwärtig alternativen führt dessen mehreren erneut genutzt jeden
    erreicht ihrem zeigen anhand hintergrund statt direkt ihren öffnet fehlt nichts probleme
    angewendet formen gute beeinflusst drucken machen importieren einstellung angelegt einigen
    sofern eingabedatei gültige unterstützte installierte ihnen stellen zugriff alte dateiformat
    weise überschreiben folgen verwendeten ergebnis erfolgt nutzen eingeben herunterladen richtung
    läuft ändert möglicherweise wieder ermittelt wechseln verändern letzten alternativ pfadname
    beeinflussen grund erkannt dabei zwischenspeicher geladen regulären impliziert ignorieren
    festgelegt übersprungen funktionieren gib abbrechen rahmen eigenschaften bestimmten schließen
    erfordert verarbeitet stellt dateisystem kopien paketes tabelle geräte bevor elemente außerhalb
    werkzeug versionsnummer vier abhängig schneller meisten dasselbe jetzt manuell ebenfalls könnten
    gewählt verfügbaren beibehalten anfang identisch wenig leere quellen kopie weniger prozentsatz
    lokale abgebrochen umschalten führen paketnamen uhrzeigersinn einstellungsdatei gefolgt
    unbekannt rechner einfache davon heruntergeladen drei spezielle klasse worden unbekannter
    entsprechend auflisten aktualisierungen genug lange prüfsumme gleich suche kodierung typen
    verknüpfung schlüssel datenstrom warnungen folgt aktuell abfragen teilen vermeiden besteht
    vergrößern felder englisch ausgaben eigenschaft vollständig erhöhen anzuzeigen markierung halten
    ausführung darauf automatische konfigurationsdateien unabhängig verloren stufe etwa druck
    übersetzung bearbeitet wirkt einträge überschreiten buchstaben liegt beginnt vorgang markiert
    konnten wirklich sperren bereitgestellt dafür sprache anpassung wirksam spezifiziert dort
    anfrage adressen sicher vollbild zwischenablage dazu dennoch außerdem niemals beispielsweise
    üblicherweise typischerweise usw dadurch bekannt heute gestern morgen hallo guten abend nacht
    woche jahr stunde stunden minuten tage freund freundin freunde danke entschuldigung natürlich
    vielleicht früh spät langsam allein schlecht einfach schwierig froh glücklich müde fertig bist
    seid hatte habe gehe gehst geht gehen mache macht sagt willst kannst weiß weißt glaube denke
    finde mag möchte jener wieviel gegen jemand niemand nie schon nein
  `,
  // Dutch, 649 words.
  nl: `
    het een niet voor worden als wordt kan dit bestand geen naar aan deze zijn pakket bij uit
    gebruikt alle verwijderen versie optie pakketten standaard bestanden gebruik gebruiken tonen zal
    opgegeven indien naam maken objecten instellen nieuwe opties gebruiker groep kunnen werd huidige
    laag maar geselecteerde fout heeft waarde andere ook meer openen ingesteld volgende tekst enkel
    informatie toevoegen mislukt zoals sinds aantal configuratiebestand kon lijst selectie
    installeren weergeven moeten plaats pagina aanpassen configuratie automatisch alleen systeem
    verplaatsen grootte verwijderd zonder bevat schijf klik aanmaken paden selecteren elke nieuw
    uitvoer tussen geïnstalleerd selecteer afbeelding opnieuw geselecteerd regel bestaat wanneer
    breedte gevonden ongeldige inhoud wachtwoord beschikbaar hebben archief staat geven exporteren
    modus kunt uitgevoerd bewerken mogelijk bijvoorbeeld geeft opslaan meerdere nodig uitvoeren nog
    zou locatie inschakelen één zie programma welke zoeken ondersteund ongeldig instellingen
    bestandsnaam verschillende vereist wijzigen patroon zullen waarden laatste eerste dezelfde
    prioriteit installatie pakketbron kopiëren versies toepassing beschikbare kies voer afbeeldingen
    veranderen geldige waarschuwing lezen pakketnaam vervangen bevatten tijdens stellen zich vorm
    uitschakelen behouden opdracht maakt hoogte koppeling architectuur kleuren venster persoonlijke
    gebruikers merk gemaakt specifieke bereik werden vormen scherm indeling aangemaakt gaan waar
    momenteel onder omdat lokale ingeschakeld ruimte vinden sommige overschrijven alternatief mag
    importeren voorbeeld toepassen volledige bijwerken wat formaat stelt passen schrijven
    gereedschap uitbreiding stappen ondersteuning padnaam opgeslagen rond verbergen binnen stijl
    bepaalt invoer proces symbolische terug vereisten reguliere volledig werken gekozen draaien
    laten genegeerd groepen toegevoegd oude waarbij modi achtergrond kiezen zelfs veel positie
    opvragen ander gegevens regels automatische voegen voeren afsluiten methode downloaden elementen
    einde enkele hetzelfde anders negeren rechts druk probeer teken gescheiden starten onderdeel
    actief delen vorige origineel gewijzigd argumenten lege boven manier aangepast stel apparaat
    weergave verouderd configuratiebestanden leeg uitbreidingen weergegeven punten wijzigingen
    distributie ondersteunde geconfigureerd sluiten laat waarin deel tekenreeks schaal
    gebruikersnaam pakketbronnen normaal midden bestaande onbekende controleren ophalen altijd hier
    tekens geef controle getal verbinding plaatsen alles mappen toon gedefinieerd niets volgorde
    gebied onbekend mogen waarvan staan vermeld komt bezig versienummer ervan gelijk expressie tijd
    verkrijgen bepaalde hernoemen algemene plakken vanuit seconden afhankelijk buiten eigen extensie
    opgehaald geïnstalleerde samen doel originele dus tenzij geheugen zelf getoond beginnen
    beschrijving uitgeschakeld configureren doorzoeken rechten bestandssysteem nummer snelheid zodat
    kleine willekeurige actie commandoregel wel voorkomen ontbrekende relatief sleutel schakelen
    standaardwaarde markering bewerking gegeven wissen syntaxis mee doen beide vanaf bron snel
    overeen verwerken slechts raadpleeg externe voeg elkaar primaire cijfers eerst kolom bepalen
    klembord toegestaan aanwezig dient betekent beheren namen bijgewerkt hoofdmap overeenkomt
    toegang ondersteunt ontbreekt langer authenticatie volgens weet nul problemen bestaan activeren
    instelling vragen dubbele functie patronen verplaatst toestaan begint systeembeheerder halen
    vergrendelen behulp berichten koppelen overeenkomen pictogram laatst gebruikte handmatig
    uitpakken functies zeker beschadigd bepaald verwacht aangezien herstellen taal aangepaste toets
    toegepast invoegen proberen probleem fouten functionaliteit doet genereren ervoor foutmelding
    gevraagde onderdelen verwerkt titel attributen vermijden schakelt stoppen zetten vrije
    toepassingen hulp nooit niveau voorkeur behalve gedrag tweede waarop iets waardoor blijven
    ontleden acties wil meestal talen vaste resolutie actieve werkt normale resultaat expliciet
    lokaal voordat verwijder kolommen gewoon aangetroffen variabele terwijl houden zien daarvan
    meest verloren keer gaat oud opmerking processen blauw groen korte spatie markeren biedt
    samenvoegen kopie omzetten bevindt keuze inclusief combinatie houdt beperken gespecificeerd
    controleer controlesom groot verder omgeving nuttig minder uitgebreid codering geldig recente
    poort waarmee meeste benaderen bronnen annuleren gemarkeerd overgeslagen tijdelijke totaal
    ontkoppelen toont slaan groter geheel sectie compressie enige verwijdert werk waarnaar
    opwaardering opgetreden opgeven grote zouden eigenaar veranderd velden tijdelijk hoge volgen
    voegt vooraf geactiveerd gelieve eerder verouderde bibliotheek succesvol hieronder absoluut
    woord voorkeuren verschil vooraleer beleid speciale reden zowel eenvoudige geplaatst geschreven
    installeer nee uitgepakt gewoonlijk hele afdrukken nieuwste archieven voltooid gevraagd vlag
    daarom vervolgens spaties mogelijke geval ofwel volgt welk hetgeen waarvoor vandaag gisteren
    morgen hallo goedemorgen goedemiddag goedenavond nacht jaar uur minuten dagen vriend vriendin
    vrienden bedankt alsjeblieft natuurlijk echt misschien vroeg langzaam goed slecht makkelijk
    moeilijk blij gelukkig klaar heb hebt zeg zegt denk vind graag hoeveel tegen iemand niemand daar
    slagen geslaagd
  `,
}
