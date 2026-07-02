// Exam Quality Assessment System - Frontend Script

// Global variables - loaded from files
let questionContentMap = {};
let labelToQuestionId = {};
let formatImprovementData = [];
let chapterData = [];
let chapterKnowledgeMap = {};
let questionData = [];
let questionLengthData = []; // Length waterfall chart data

// Global variables
let examFile = null;
let syllabusFile = null;
let analysisData = null;
let knowledgeAnalysis = null;
let dataLoaded = false; // Data loading status
let currentDataSource = 'default'; // Current data source
let radarValueMode = 'auto'; // auto | custom
let radarCustomValues = { knowledge: null, cognitive: null, format: null }; // 0-1
let lastRadarComputed = null;
// Chapter compliance threshold (adjustable, default 40%)
let chapterComplianceRatio = 0.4;
// 知识点达成率使用的独立达标阈值（与重点达成率的 chapterComplianceRatio 解耦）
let knowledgePointComplianceRatio = 0.4;
// 大纲覆盖度折线图当前视图：'chapter-rate' | 'compliance-rate' | 'keypoint-rate'
let currentCoverageView = 'chapter-rate';

// 获取不重复的题目数量（Q18a/Q18b 视为同一道题 Q18）
function getUniqueQuestionCount() {
    const stems = new Set();
    questionData.forEach(q => {
        const stem = (q.questionId || '').replace(/[a-z]+$/, '');
        stems.add(stem);
    });
    return stems.size;
}
const defaultRadarRuleConfig = {
    knowledge: {
        // 章节覆盖率 C_ch = N_covered / N_total（百分比阶梯）
        chapterThresholds: [
            { min: 1.00, score: 5 },
            { min: 0.90, score: 4 },
            { min: 0.80, score: 3 },
            { min: 0.65, score: 2 },
            { min: 0.50, score: 1 },
            { min: 0,    score: 0 }
        ],
        // 重点达成率 R_key（每章覆盖率算术平均；百分比阶梯）
        complianceThresholds: [
            { min: 0.80, score: 5 },
            { min: 0.65, score: 4 },
            { min: 0.50, score: 3 },
            { min: 0.35, score: 2 },
            { min: 0.20, score: 1 },
            { min: 0,    score: 0 }
        ],
        // 知识点达成率 R_tot（分母为总知识点；阈值整体下调一档）
        keypointThresholds: [
            { min: 0.65, score: 5 },
            { min: 0.50, score: 4 },
            { min: 0.35, score: 3 },
            { min: 0.25, score: 2 },
            { min: 0.15, score: 1 },
            { min: 0,    score: 0 }
        ]
    },
    cognitive: {
        // Knowledge type threshold (max 3): 4 types=3, 3 types=2, 2 types=1
        knowledgeTypeThresholds: [
            { min: 4, score: 3 },
            { min: 3, score: 2 },
            { min: 2, score: 1 },
            { min: 0, score: 0 }
        ],
        // Bloom's taxonomy threshold (max 3): 5-6=3, 3-4=2, 1-2=1
        bloomThresholds: [
            { min: 5, score: 3 },
            { min: 3, score: 2 },
            { min: 1, score: 1 },
            { min: 0, score: 0 }
        ],
        // Question type threshold (max 3): 5-6=3, 3-4=2, 1-2=1
        typeThresholds: [
            { min: 5, score: 3 },
            { min: 3, score: 2 },
            { min: 1, score: 1 },
            { min: 0, score: 0 }
        ],
        // Difficulty threshold (max 1): medium >60% = 1
        difficultyThreshold: 0.6
    },
    format: {
        // Length compliance threshold: rate >= min gets score (0-5)
        lengthThresholds: [
            { min: 0.9, score: 5 },
            { min: 0.8, score: 4 },
            { min: 0.7, score: 3 },
            { min: 0.6, score: 2 },
            { min: 0.01, score: 1 },
            { min: 0, score: 0 }
        ],
        // Format accuracy threshold: accuracy >= min gets score (0-5)
        accuracyThresholds: [
            { min: 0.8, score: 5 },
            { min: 0.7, score: 4 },
            { min: 0.6, score: 3 },
            { min: 0.4, score: 2 },
            { min: 0.01, score: 1 },
            { min: 0, score: 0 }
        ]
    }
};
let radarRuleConfig = JSON.parse(JSON.stringify(defaultRadarRuleConfig));
let currentRuleMetric = 'knowledge'; // 当前显示的规则指标

// 纯前端部署（如 Vercel 静态站点）时的数据源候选
const STATIC_DATA_SOURCE_CANDIDATES = [
    'default',
    '2025考研真题',
    '2025考研数学真题',
    'ai_zhangyu8',
    'AI_数据结构',
    '考研数学真题（英文）',
    '数据库原理（中文）',
    '数据库原理（英文）',
    'ai_20260404_171823__20260404091829',
    'ai_20260404_174357__20260404094402',
    'ai_20260402_235013__20260402155020',
    'ai_20260326_091013_25-2_20260326011021',
    'ai_20260326_150101_A24-_20260326070108'
];

function getDataBasePath(dataSource = 'default') {
    if (dataSource === '__root__') return '/data';
    return encodeURI(`/data/${dataSource}`);
}

async function fetchJsonStrict(url, label) {
    const response = await fetch(url);
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${label} 加载失败（${response.status}）: ${body.slice(0, 80)}`);
    }
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} 不是合法 JSON: ${text.slice(0, 80)}`);
    }
}

async function detectStaticDataSources() {
    const cacheBust = `?t=${Date.now()}`;
    const checks = await Promise.all(
        STATIC_DATA_SOURCE_CANDIDATES.map(async (source) => {
            const basePath = getDataBasePath(source);
            try {
                const response = await fetch(`${basePath}/questionData.json${cacheBust}`);
                return response.ok ? source : null;
            } catch (error) {
                return null;
            }
        })
    );

    const validSources = checks.filter(Boolean);
    if (validSources.length > 0) return validSources;

    // 兼容 /data 下直接放 json 文件（无子目录）的部署
    try {
        const rootRes = await fetch(`/data/questionData.json${cacheBust}`);
        if (rootRes.ok) return ['__root__'];
    } catch (error) {
        // noop
    }

    return [];
}

// 初始化
document.addEventListener('DOMContentLoaded', async function() {
    try {
        console.log('正在初始化试卷覆盖度可视化评估系统...');
        // 先加载可用数据源
        await loadDataSources();
        // 再加载数据（使用当前选中的数据源）
        await loadAllData(currentDataSource);
        // 初始化事件监听与图表
        initializeEventListeners();
        initializeCharts();
        console.log('初始化完成');
    } catch (error) {
        console.error('初始化出错：', error);
        alert('页面初始化失败：' + error.message);
    }
});

// 加载数据源列表
async function loadDataSources() {
    const formatDataSourceLabel = (source) => {
        const map = {
            // 英文示例数据集（保留兼容旧目录名）
            en_default: '英文示例 - 默认',
            en_2025_exam: '英文示例 - 2025 考研',
            en_2026_zhang8_1: '英文示例 - 2026 张8（1）',
            // 中文数据集
            default: '默认数据集',
            '2025考研真题': '2025 考研真题',
            '2026张8（1）': '2026 张8（1）',
            '__root__': '默认数据集（根目录）'
        };
        if (map[source]) return map[source];
        if (/[\u4e00-\u9fff]/.test(source)) return source;
        return source;
    };

    const updateDataSourceSelect = (sources) => {
        const dataSourceSelect = document.getElementById('dataSourceSelect');
        if (!dataSourceSelect) return;

        dataSourceSelect.innerHTML = '';
        sources.forEach(source => {
            const option = document.createElement('option');
            option.value = source;
            option.textContent = formatDataSourceLabel(source);
            dataSourceSelect.appendChild(option);
        });

        if (sources.length > 0) {
            const preferred = sources.find(s => /[\u4e00-\u9fff]/.test(s) || s === 'default')
                || sources[0];
            dataSourceSelect.value = preferred;
            currentDataSource = preferred;
        }
    };

    try {
        const response = await fetch('/api/data-sources');
        if (!response.ok) {
            throw new Error(`/api/data-sources ${response.status}`);
        }
        const data = await response.json();

        if (data.success && data.data_sources) {
            updateDataSourceSelect(data.data_sources);
            console.log('数据源列表加载完成:', data.data_sources);
        } else {
            throw new Error('后端未返回数据源列表');
        }
    } catch (error) {
        console.warn('后端数据源接口不可用，切换静态数据源模式:', error.message);
        const staticSources = await detectStaticDataSources();
        if (staticSources.length > 0) {
            updateDataSourceSelect(staticSources);
            console.log('静态数据源列表:', staticSources);
            return;
        }
        throw new Error('未检测到可用数据源。请确认 data 目录已上传且包含 JSON 数据文件。');
    }
}

// 加载所有数据文件
async function loadAllData(dataSource = 'default') {
    try {
        currentDataSource = dataSource;
        const dataPath = getDataBasePath(dataSource);
        const cacheBust = `?t=${Date.now()}`;
        console.log(`Loading data... source: ${dataSource}`);
        
        // 并行加载所有数据文件（questionLengthData为可选文件），添加缓存破坏参数
        const [
            questionContentMapData,
            labelToQuestionIdData,
            formatImprovementDataData,
            chapterDataData,
            chapterKnowledgeMapData,
            questionDataData,
            questionLengthDataResult
        ] = await Promise.all([
            fetchJsonStrict(`${dataPath}/questionContentMap.json${cacheBust}`, 'questionContentMap.json'),
            fetchJsonStrict(`${dataPath}/labelToQuestionId.json${cacheBust}`, 'labelToQuestionId.json'),
            fetchJsonStrict(`${dataPath}/formatImprovementData.json${cacheBust}`, 'formatImprovementData.json'),
            fetchJsonStrict(`${dataPath}/chapterData.json${cacheBust}`, 'chapterData.json'),
            fetchJsonStrict(`${dataPath}/chapterKnowledgeMap.json${cacheBust}`, 'chapterKnowledgeMap.json'),
            fetchJsonStrict(`${dataPath}/questionData.json${cacheBust}`, 'questionData.json'),
            // questionLengthData 为可选文件，加载失败时返回空数组
            fetch(`${dataPath}/questionLengthData.json${cacheBust}`)
                .then(r => r.ok ? r.json() : [])
                .catch(() => [])
        ]);
        
        // 将数据赋值给全局变量
        questionContentMap = questionContentMapData;
        labelToQuestionId = labelToQuestionIdData;
        formatImprovementData = formatImprovementDataData;
        chapterData = chapterDataData;
        chapterKnowledgeMap = chapterKnowledgeMapData;
        questionData = questionDataData;
        questionLengthData = questionLengthDataResult;
        
        // 将chapterKnowledgeMap的键转换为数字类型（因为JSON中键是字符串）
        const normalizedChapterKnowledgeMap = {};
        for (const key in chapterKnowledgeMap) {
            normalizedChapterKnowledgeMap[parseInt(key)] = chapterKnowledgeMap[key];
        }
        chapterKnowledgeMap = normalizedChapterKnowledgeMap;
        
        dataLoaded = true;
        
        // 重建题目分数映射表（数据源切换后必须重建）
        rebuildQuestionScoreMap();
        // 静态部署没有 /api/analyze 返回的 analysisData，这里用本地 JSON 标记为可渲染状态。
        analysisData = analysisData || { source: 'static-json', knowledge_analysis: null };
        
        console.log('全部数据文件加载完成');
        console.log('数据源:', dataSource);
        console.log('题目内容映射条数:', Object.keys(questionContentMap).length);
        console.log('章节数:', chapterData.length);
        console.log('题目数:', questionData.length);
        console.log('篇幅条目数:', questionLengthData.length);
    } catch (error) {
        console.error('数据文件加载失败:', error);
        alert(`数据加载失败（数据源：${dataSource}）。请检查所需的 JSON 文件。错误信息：` + error.message);
        throw error;
    }
}

// 切换数据源
async function switchDataSource(dataSource) {
    const previousSource = currentDataSource;
    // 先移除之前可能残留的 overlay
    document.getElementById('loading-overlay')?.remove();
    
    try {
        console.log(`正在切换数据源至：${dataSource}`);
        const loadingMsg = document.createElement('div');
        loadingMsg.id = 'loading-overlay';
        loadingMsg.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999;">
                <div style="background: #fff; padding: 20px 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <p style="margin: 0; font-size: 16px; color: #333;">🔄 正在切换数据源…</p>
                </div>
            </div>
        `;
        document.body.appendChild(loadingMsg);
        
        // 加载新数据
        await loadAllData(dataSource);
        
        // 让 DOM 有机会更新
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // 直接刷新所有图表（每个独立 try-catch，避免一个失败全部空白）
        const chartUpdaters = [
            ['KnowledgeGrid', updateKnowledgeGrid],
            ['KnowledgeLineChart', updateKnowledgeLineChart],
            ['CognitiveHeatmap', updateCognitiveHeatmap],
            ['CognitiveDonutChart', updateCognitiveDonutChart],
            ['FormatBarChart', updateFormatBarChart],
            ['RadarChart', updateRadarChart],
        ];
        for (const [name, fn] of chartUpdaters) {
            try {
                fn();
            } catch (e) {
                console.error(`[switchDataSource] ${name} failed:`, e);
            }
        }
        console.log('数据源切换后所有图表已尝试刷新');
        
        // 重置为知识点覆盖视图
        switchMetric('knowledge');
        
        console.log(`数据源已切换：${dataSource}`);
    } catch (error) {
        console.error('数据源切换失败:', error);
        const select = document.getElementById('dataSourceSelect');
        if (select) {
            select.value = previousSource;
        }
    } finally {
        document.getElementById('loading-overlay')?.remove();
    }
}

// 全局错误处理
window.addEventListener('error', function(event) {
    console.error('全局错误:', event.error);
    console.error('错误位置:', event.filename, ':', event.lineno);
});

// 未处理的Promise拒绝
window.addEventListener('unhandledrejection', function(event) {
    console.error('未处理的Promise拒绝:', event.reason);
});

// 初始化事件监听器
function initializeEventListeners() {
    // 数据源切换
    const dataSourceSelect = document.getElementById('dataSourceSelect');
    if (dataSourceSelect) {
        dataSourceSelect.addEventListener('change', function() {
            switchDataSource(this.value);
        });
    }
    
    // 文件上传
    const fileInput = document.getElementById('fileInput');
    const syllabusInput = document.getElementById('syllabusInput');
    
    if (fileInput) {
        fileInput.addEventListener('change', handleExamFileSelect);
    }
    
    if (syllabusInput) {
        syllabusInput.addEventListener('change', handleSyllabusFileSelect);
    }
    
    // 覆盖度视图切换（章节覆盖率 / 重点达成率 / 知识点达成率）
    const coverageViewItems = document.querySelectorAll('.metric-item[data-coverage-view]');
    coverageViewItems.forEach(item => {
        item.addEventListener('click', function() {
            const view = this.getAttribute('data-coverage-view');
            switchCoverageView(view);
        });
    });
    
    // 雷达分值调节
    setupRadarControls();
    
    // 导出修正后的题目按钮
    const exportBtn = document.getElementById('export-corrections-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportCorrections);
    }
    
    // Edit 功能按钮 (Self-Polish Framework)
    const editGenerateBtn = document.getElementById('edit-generate-btn');
    const editAcceptBtn = document.getElementById('edit-accept-btn');
    const editExportBtn = document.getElementById('edit-export-btn');
    
    if (editGenerateBtn) {
        editGenerateBtn.addEventListener('click', generateImprovedQuestions);
    }
    if (editAcceptBtn) {
        editAcceptBtn.addEventListener('click', acceptSelectedQuestions);
    }
    if (editExportBtn) {
        editExportBtn.addEventListener('click', exportImprovedQuestions);
    }
    
    // Quality Summary Update button
    const summaryUpdateBtn = document.querySelector('.summary-btn.update-btn');
    if (summaryUpdateBtn) {
        summaryUpdateBtn.addEventListener('click', generateQualitySummary);
    }
    
    // Quality Summary Export button
    const summaryExportBtn = document.querySelector('.summary-btn.export-btn');
    if (summaryExportBtn) {
        summaryExportBtn.addEventListener('click', exportQualityReport);
    }
}

function setFileNameLabel(labelId, file) {
    const el = document.getElementById(labelId);
    if (!el) return;
    el.textContent = file?.name ? file.name : '未选择文件';
}

// 处理试卷文件选择
function handleExamFileSelect(event) {
    const file = event.target.files[0];
    setFileNameLabel('fileInputName', file);
    if (file) {
        console.log('试卷文件已选择:', file.name);
        examFile = { file: file, filename: file.name, uploading: true };
        uploadFile(file, 'exam');
    }
}

// 处理考纲文件选择
function handleSyllabusFileSelect(event) {
    const file = event.target.files[0];
    setFileNameLabel('syllabusInputName', file);
    if (file) {
        console.log('考纲文件已选择:', file.name);
        syllabusFile = { file: file, filename: file.name, uploading: true };
        uploadFile(file, 'syllabus');
    }
}

// 上传文件
function uploadFile(file, type) {
    const formData = new FormData();
    formData.append('file', file);
    
    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`上传失败：${response.status} ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            console.error('上传失败:', data.error);
            alert('上传失败：' + data.error);
            if (type === 'exam') {
                if (examFile) {
                    examFile.uploading = false;
                    examFile.error = data.error;
                }
            } else {
                if (syllabusFile) {
                    syllabusFile.uploading = false;
                    syllabusFile.error = data.error;
                }
            }
        } else {
            console.log('上传成功:', data.filename);
            // 使用后端返回的文件路径（可能是绝对路径或相对路径）
            // 后端会处理路径转换，所以我们直接使用返回的filepath
            const filepath = data.filepath || `uploads/${data.filename}`;
            if (type === 'exam') {
                if (examFile) {
                    examFile.filepath = filepath;
                    examFile.filename = data.filename;
                    examFile.uploading = false;
                    examFile.error = null;
                    console.log('试卷文件路径:', filepath);
                } else {
                    examFile = { filepath: filepath, filename: data.filename, uploading: false };
                }
            } else {
                if (syllabusFile) {
                    syllabusFile.filepath = filepath;
                    syllabusFile.filename = data.filename;
                    syllabusFile.uploading = false;
                    syllabusFile.error = null;
                    console.log('考纲文件路径:', filepath);
                } else {
                    syllabusFile = { filepath: filepath, filename: data.filename, uploading: false };
                }
            }
            
            // 检查两个文件是否都上传完成，自动触发AI数据生成
            checkAndTriggerAIGeneration();
        }
    })
    .catch(error => {
        console.error('上传出错:', error);
        alert('上传失败：' + error.message);
        if (type === 'exam') {
            if (examFile) {
                examFile.uploading = false;
                examFile.error = error.message;
            }
        } else {
            if (syllabusFile) {
                syllabusFile.uploading = false;
                syllabusFile.error = error.message;
            }
        }
    });
}

// 检查并触发AI数据生成
function checkAndTriggerAIGeneration() {
    // 检查两个文件是否都上传成功
    if (!examFile || !syllabusFile) return;
    if (examFile.uploading || syllabusFile.uploading) return;
    if (!examFile.filepath || !syllabusFile.filepath) return;
    if (examFile.error || syllabusFile.error) return;
    
    console.log('两个文件都已上传，开始AI数据生成...');
    triggerAIDataGeneration();
}

// 触发AI数据生成
function triggerAIDataGeneration() {
    // 生成数据源名称（基于时间戳）
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').substring(0, 14);
    const examName = examFile.filename.replace(/\.[^/.]+$/, '').substring(0, 20);
    const dataSourceName = `ai_${examName}_${timestamp}`;
    
    // 显示生成中提示
    showGeneratingStatus(true);
    
    const requestData = {
        examFilepath: examFile.filepath,
        syllabusFilepath: syllabusFile.filepath,
        dataSourceName: dataSourceName
    };
    
    console.log('请求AI数据生成:', requestData);
    
    fetch('/api/generate-data', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
    })
    .then(response => response.json())
    .then(data => {
        showGeneratingStatus(false);
        
        if (data.error) {
            console.error('AI数据生成失败:', data.error);
            alert('AI 数据生成失败：' + data.error);
        } else {
            console.log('AI数据生成成功:', data);
            alert(`数据生成成功！\n数据源：${data.dataSourceName}\n已保存文件：${data.filesSaved.join('、')}`);
            
            // 刷新数据源列表
            loadDataSources();
            
            // 自动切换到新生成的数据源
            setTimeout(() => {
                const select = document.getElementById('dataSourceSelect');
                if (select) {
                    // 查找新生成的数据源选项
                    for (let option of select.options) {
                        if (option.value === data.dataSourceName) {
                            select.value = data.dataSourceName;
                            switchDataSource(data.dataSourceName);
                            break;
                        }
                    }
                }
            }, 500);
        }
    })
    .catch(error => {
        showGeneratingStatus(false);
        console.error('AI数据生成请求失败:', error);
        alert('AI 数据生成请求失败：' + error.message);
    });
}

// 显示/隐藏生成中状态
function showGeneratingStatus(show) {
    // 更新文件选择区域显示状态
    const fileSelection = document.querySelector('.file-selection');
    if (!fileSelection) return;
    
    // 查找或创建状态提示元素
    let statusDiv = document.getElementById('ai-generating-status');
    
    if (show) {
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'ai-generating-status';
            statusDiv.style.cssText = 'background: #e3f2fd; border: 1px solid #2196f3; border-radius: 4px; padding: 8px 12px; margin-top: 8px; text-align: center; font-size: 12px; color: #1565c0;';
            statusDiv.innerHTML = '<span style="display: inline-block; animation: pulse 1.5s infinite;">🤖 AI 正在分析并生成数据…</span>';
            fileSelection.appendChild(statusDiv);
            
            // 添加动画样式
            if (!document.getElementById('pulse-animation-style')) {
                const style = document.createElement('style');
                style.id = 'pulse-animation-style';
                style.textContent = '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }';
                document.head.appendChild(style);
            }
        }
    } else {
        if (statusDiv) {
            statusDiv.remove();
        }
    }
}

// 开始分析
function startAnalysis() {
    if (!examFile || !syllabusFile) {
        alert('请先选择试卷文件与考纲文件。');
        return;
    }
    
    // 检查文件是否还在上传中
    if (examFile.uploading || syllabusFile.uploading) {
        alert('文件正在上传，请稍候…');
        return;
    }
    
    // 检查文件路径是否存在
    if (!examFile.filepath && !examFile.filename) {
        alert('试卷文件上传失败，请重新选择。');
        return;
    }
    
    if (!syllabusFile.filepath && !syllabusFile.filename) {
        alert('考纲文件上传失败，请重新选择。');
        return;
    }
    
    // 使用上传后返回的文件路径
    const examFilepath = examFile.filepath || (examFile.filename ? `uploads/${examFile.filename}` : null);
    const syllabusFilepath = syllabusFile.filepath || (syllabusFile.filename ? `uploads/${syllabusFile.filename}` : null);
    
    if (!examFilepath || !syllabusFilepath) {
        alert('文件路径无效，请重新上传。');
        return;
    }
    
    const requestData = {
        examFilepath: examFilepath,
        syllabusFilepath: syllabusFilepath,
        type: 'pre'
    };
    
    fetch('/api/analyze', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            console.error('分析失败:', data.error);
            alert('分析失败：' + data.error);
        } else if (data.success) {
            console.log('分析成功:', data.data);
            analysisData = data.data;
            knowledgeAnalysis = data.data.knowledge_analysis || null;
            updateAllCharts();
        }
    })
    .catch(error => {
        console.error('分析出错:', error);
        alert('分析出错：' + error.message);
    })
    .finally(() => {
        // 分析完成后的清理工作
    });
}

// Show treemap description
function showTreemapDescription() {
    const displayArea = document.getElementById('chapter-content-display');
    if (!displayArea) return;
    
    const html = `
        <div class="chapter-detail">
            <h5>📊 图表说明</h5>
            <div class="chapter-description">
                <p><strong>树图方格：</strong>方格大小对应该章节的分值占比，越大表示分值越高；蓝色深浅表示覆盖度（&lt;40% 浅、40–60% 中、&gt;60% 深）。</p>
                <p><strong>树图圆点：</strong>青色圆代表知识点，圆的大小对应所涉分值；橙色圆代表题目，圆的大小对应题目分值。</p>
                <p><strong>折线图：</strong>蓝实线=每章实际考查的知识点数；红虚线=每章应覆盖的重点条目数。点击左侧方格 / 圆点可查看具体章节的要求与关键知识点。</p>
            </div>
        </div>
    `;
    
    displayArea.innerHTML = html;
}

// 更新环形图
function updateDonutChart(axis) {
    const svg = d3.select('#dimension-donut-svg');
    svg.selectAll('*').remove();
    
    // 更新标题
    const titleElement = document.getElementById('dimension-donut-title');
    if (titleElement) {
        titleElement.textContent = axis.name + '分布';
    }
    
    // 统计每个类别的题目数量
    const countMap = {};
    axis.values.forEach(value => {
        countMap[value] = 0;
    });
    
    questionData.forEach(q => {
        const value = q[axis.field];
        if (countMap[value] !== undefined) {
            countMap[value]++;
        }
    });
    
    // 转换为数组格式
    const data = axis.values.map((value, index) => ({
        label: value,
        count: countMap[value],
        color: axis.colors[value] || axis.colors[index] || '#ccc' // 支持对象和数组两种格式
    }));
    
    const totalQuestions = getUniqueQuestionCount();
    
    // 绘制环形图（缩小）
    const width = 400;
    const height = 380;
    const radius = Math.min(width, height - 80) / 2 - 30; // 缩小半径
    const innerRadius = radius * 0.55;
    
    const g = svg.append('g')
        .attr('transform', `translate(${width/2}, ${height/2 + 10})`);
    
    const pie = d3.pie()
        .value(d => d.count || 0.01) // 值为0时也显示一个很小的扇区
        .sort(null);
    
    const arc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(radius);
    
    const hoverArc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(radius + 10);
    
    const arcs = g.selectAll('.arc')
        .data(pie(data))
        .enter()
        .append('g')
        .attr('class', 'arc');
    
    arcs.append('path')
        .attr('d', arc)
        .attr('fill', d => d.data.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .style('cursor', 'pointer')
        .style('transition', 'all 0.3s ease')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr('d', hoverArc);
        })
        .on('mouseout', function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr('d', arc);
        });
    
    // 中心显示总题数
    g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.5em')
        .style('font-size', '24px')
        .style('font-weight', 'bold')
        .style('fill', '#333')
        .text(totalQuestions);
    
    g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.2em')
        .style('font-size', '14px')
        .style('fill', '#666')
        .text('题目总数');
    
    // 图例（右上角，精确位置）
    const legend = svg.append('g')
        .attr('transform', `translate(330, 2)`);
    
    data.forEach((d, i) => {
        const legendRow = legend.append('g')
            .attr('transform', `translate(0, ${i * 24})`);
        
        legendRow.append('rect')
            .attr('width', 16)
            .attr('height', 16)
            .attr('fill', d.color)
            .attr('rx', 3);
        
        legendRow.append('text')
            .attr('x', 22)
            .attr('y', 13)
            .style('font-size', '11px')
            .style('fill', '#333')
            .text(cnLabel(d.label));
    });
    
    // 更新统计信息
    updateDonutStats(data, totalQuestions);
}

// 更新环形图统计信息（紧凑版）
function updateDonutStats(data, total) {
    const statsDisplay = document.getElementById('cognitive-stats-display');
    if (!statsDisplay) return;
    
    let html = `
        <div style="display: flex; justify-content: space-between; gap: 3px; margin-bottom: 4px; width: 100%; box-sizing: border-box;">`;
    
    data.forEach(d => {
        const percentage = total > 0 ? ((d.count / total) * 100).toFixed(0) : '0';
        // 针对较长的标签进一步缩小字号
        const labelFontSize = d.label.length > 10 ? '7px' : '8px';
        html += `
            <div style="flex: 1; min-width: 0; text-align: center; padding: 3px 1px; background: #fff; border-radius: 3px; border-bottom: 2px solid ${d.color}; box-sizing: border-box; overflow: hidden;">
                <span style="color: #666; font-size: ${labelFontSize}; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${cnLabel(d.label)}">${cnLabel(d.label)}</span>
                <strong style="color: #333; font-size: 12px; display: block; line-height: 1.2;">${d.count}</strong>
                <span style="font-size: 7px; color: #888; display: block; line-height: 1;">(${percentage}%)</span>
            </div>
        `;
    });
    
    html += `</div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 3px 6px; background: #fff; border-radius: 4px; font-size: 10px; color: #555;">
            <span style="font-weight: 600;">总计：</span>
            <strong style="color: #333; font-size: 12px;">${total}</strong>
            <span>题</span>
    </div>`;
    
    statsDisplay.innerHTML = html;
}

// 估算单个章节的「总知识点数」
//   - 若 chapter.totalKnowledgePointsCount 存在则直接使用；
//   - 否则按 description 字段拆分（按 中文逗号/顿号/分号/句号 切分，先剔除括号内容）；
//   - 若 description 也缺失，则退化为 keyPointsCount。
function getChapterTotalKnowledgePoints(chapter) {
    if (!chapter) return 0;
    if (typeof chapter.totalKnowledgePointsCount === 'number') {
        return chapter.totalKnowledgePointsCount;
    }
    if (chapter.description) {
        const cleaned = chapter.description.replace(/（[^）]*）|\([^)]*\)/g, '');
        const items = cleaned.split(/[，、；。\s]+/).filter(s => s.trim().length > 0);
        if (items.length > 0) return items.length;
    }
    return chapter.keyPointsCount || 0;
}

// 切换大纲覆盖度子视图（章节覆盖率 / 重点达成率 / 知识点达成率）
function switchCoverageView(view) {
    if (!['chapter-rate', 'compliance-rate', 'keypoint-rate'].includes(view)) {
        view = 'chapter-rate';
    }
    currentCoverageView = view;
    document.querySelectorAll('.metric-item[data-coverage-view]').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-coverage-view') === view);
    });
    // 重绘折线图（图例、Y轴、线条数据、统计区都会按当前视图刷新）
    try { updateKnowledgeLineChart(); } catch (e) { console.error('[switchCoverageView] failed:', e); }
    // 评分规则面板按当前视图切换显示对应规则
    selectedSegment = { barId: null, idx: null };
    try { renderRadarRuleForm(); } catch (e) { console.error('[switchCoverageView] renderRadarRuleForm failed:', e); }
    // 评分卡片高亮当前视图对应的子分
    try { updateRadarChart(); } catch (e) { console.error('[switchCoverageView] updateRadarChart failed:', e); }
}

// 切换评估指标
function switchMetric(metric) {
    // 更新指标项样式（仅限带 data-metric 的旧按钮，避免影响新的 data-coverage-view tab）
    document.querySelectorAll('.metric-item[data-metric]').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.metric-item[data-metric="${metric}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // 显示/隐藏对应的图表
    const knowledgeHeader = document.getElementById('knowledge-header');
    const knowledgeGrid = document.getElementById('knowledge-grid');
    const cognitiveHeatmap = document.getElementById('cognitive-heatmap');
    const formatBarChart = document.getElementById('format-bar-chart');
    const knowledgeLineChart = document.getElementById('knowledge-line-chart');
    const dimensionDonutChart = document.getElementById('dimension-donut-chart');
    
    if (metric === 'knowledge') {
        if (knowledgeHeader) knowledgeHeader.style.display = 'flex';
        if (knowledgeGrid) knowledgeGrid.style.display = 'flex';
        if (cognitiveHeatmap) cognitiveHeatmap.style.display = 'none';
        if (formatBarChart) formatBarChart.style.display = 'none'; // 隐藏形式规范柱状图
        if (knowledgeLineChart) knowledgeLineChart.style.display = 'block';
        if (dimensionDonutChart) dimensionDonutChart.style.display = 'none';
        // 隐藏瀑布图（知识点覆盖仅显示折线图）
        const questionStackChart = document.getElementById('question-stack-chart');
        if (questionStackChart) {
            questionStackChart.style.display = 'none';
        }
        
        // 显示树图说明文字
        showTreemapDescription();
        
        // 更新规则面板
        currentRuleMetric = 'knowledge';
        selectedSegment = { barId: null, idx: null };
        renderRadarRuleForm();
    } else if (metric === 'cognitive') {
        if (knowledgeHeader) knowledgeHeader.style.display = 'none';
        if (knowledgeGrid) knowledgeGrid.style.display = 'none';
        if (formatBarChart) formatBarChart.style.display = 'none';
        if (knowledgeLineChart) knowledgeLineChart.style.display = 'none';
        if (dimensionDonutChart) dimensionDonutChart.style.display = 'block';
        const questionStackChart2 = document.getElementById('question-stack-chart');
        if (questionStackChart2) {
            questionStackChart2.style.display = 'none';
        }
        // 先在容器隐藏时绘制图表，避免切换时闪烁旧布局
        try {
            initializePHPChart();
            if (typeof phpAxesConfig !== 'undefined' && phpAxesConfig.length > 0) {
                updateDonutChart(phpAxesConfig[0]);
            }
        } catch (e) {
            console.error('初始化认知领域图失败:', e);
        }
        // 绘制完成后再显示容器（使用 flex 保持正确的弹性布局）
        if (cognitiveHeatmap) cognitiveHeatmap.style.display = 'flex';
        
        currentRuleMetric = 'cognitive';
        selectedSegment = { barId: null, idx: null };
        renderRadarRuleForm();
    } else if (metric === 'format') {
        if (knowledgeHeader) knowledgeHeader.style.display = 'none';
        if (knowledgeGrid) knowledgeGrid.style.display = 'none';
        if (cognitiveHeatmap) cognitiveHeatmap.style.display = 'none';
        if (formatBarChart) formatBarChart.style.display = 'block'; // 仅形式规范时显示
        if (knowledgeLineChart) knowledgeLineChart.style.display = 'none'; // 隐藏知识点覆盖折线图
        if (dimensionDonutChart) dimensionDonutChart.style.display = 'none';
        
        // 显示大题字符数堆叠瀑布图
        const questionStackChart = document.getElementById('question-stack-chart');
        if (questionStackChart) {
            questionStackChart.style.display = 'block';
            updateQuestionStackChart();
        }
        
        // 更新形式规范表格和散点图
        updateFormatBarChart();
        
        // 更新规则面板
        currentRuleMetric = 'format';
        selectedSegment = { barId: null, idx: null };
        renderRadarRuleForm();
    } else {
        // 隐藏大题字符数堆叠瀑布图
        const questionStackChart = document.getElementById('question-stack-chart');
        if (questionStackChart) {
            questionStackChart.style.display = 'none';
        }
    }
}

// 初始化图表
function initializeCharts() {
    console.log('初始化图表...');
    
    // 确保元素存在并设置初始显示状态
    const knowledgeHeader = document.getElementById('knowledge-header');
    const knowledgeGrid = document.getElementById('knowledge-grid');
    const cognitiveHeatmap = document.getElementById('cognitive-heatmap');
    const formatBarChart = document.getElementById('format-bar-chart');
    
    if (knowledgeHeader) {
        knowledgeHeader.style.display = 'flex';
        console.log('knowledge-header设置为显示');
    }
    if (knowledgeGrid) {
        knowledgeGrid.style.display = 'flex';
        console.log('knowledge-grid设置为显示');
    }
    if (cognitiveHeatmap) {
        cognitiveHeatmap.style.display = 'none';
        console.log('cognitive-heatmap设置为隐藏');
    }
    if (formatBarChart) {
        formatBarChart.style.display = 'none';
        console.log('format-bar-chart设置为隐藏');
    }
    
    // 默认显示知识点覆盖
    switchMetric('knowledge');
    
    // 自动加载已有数据
    loadExistingData();
}

// 加载已有数据
function loadExistingData() {
    console.log('正在加载已有数据...');

    if (dataLoaded) {
        console.log('已加载静态数据，跳过后端 /api/load-data，直接刷新图表。');
        analysisData = analysisData || { source: 'static-json', knowledge_analysis: null };
        updateAllCharts();
        return;
    }
    
    fetch('/api/load-data', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            console.error('加载数据失败:', data.error);
            console.log('等待用户上传文件并分析...');
        } else if (data.success) {
            console.log('数据加载成功:', data.data);
            analysisData = data.data;
            knowledgeAnalysis = data.data.knowledge_analysis || null;
            updateAllCharts();
            console.log('图表已更新');
        }
    })
    .catch(error => {
        console.error('加载数据错误:', error);
        console.log('等待用户上传文件并分析...');
    });
}

// 更新所有图表
function updateAllCharts() {
    if (!analysisData && !dataLoaded) {
        console.warn('没有分析数据，无法更新图表');
        return;
    }
    
    console.log('开始更新所有图表...');
    
    const chartUpdaters = [
        ['KnowledgeGrid', updateKnowledgeGrid],
        ['KnowledgeLineChart', updateKnowledgeLineChart],
        ['CognitiveHeatmap', updateCognitiveHeatmap],
        ['CognitiveDonutChart', updateCognitiveDonutChart],
        ['FormatBarChart', updateFormatBarChart],
        ['RadarChart', updateRadarChart],
    ];
    for (const [name, fn] of chartUpdaters) {
        try {
            fn();
        } catch (error) {
            console.error(`[updateAllCharts] ${name} failed:`, error);
        }
    }
    console.log('所有图表更新完成');
}

/* 
// 14个章节的数据定义（从大纲图提取）- 已移动到数据文件 chapterData.json
// 数据现在从 /data/chapterData.json 加载
const _deprecated_chapterData_comment = [
    { 
        id: 1, 
        name: "数据库概论", 
        row: 0, 
        col: 0,
        description: "要求学生了解数据、信息、数据库、数据库系统管理系统的概念及人工管理阶段、文件系统阶段和数据库系统阶段数据库系统的组成。",
        keyPoints: "数据管理技术的进展、数据库系统的组成和结构、常用的数据库管理系统",
        keyPointsCount: 3 // 3个重点
    },
    { 
        id: 2, 
        name: "数据模型", 
        row: 0, 
        col: 1,
        description: "要求学生掌握关系数据模型的基本概念、层次、网状模型、关系模型、物理模型等，能够对数据库管理系统对数据的组织。",
        keyPoints: "数据模型、概念模型、DBMS 支持的数据模型",
        keyPointsCount: 3
    },
    { 
        id: 3, 
        name: "关系数据库", 
        row: 0, 
        col: 2,
        description: "要求学生掌握关系系统模型的基本概念、包括关系、元组、属性、键、关系模式、关系数据库、主键、外键等概念，了解关系的完整性规则，能够应用集合论、谓词演算和代数的基本知识理解关系模型。",
        keyPoints: "关系的数学定义、关系代数",
        keyPointsCount: 2
    },
    { 
        id: 4, 
        name: "关系数据库理论", 
        row: 0, 
        col: 3,
        description: "要求学生掌握关系数据库规范化的理论依据和标准形式，包括1NF范式（满足部分函数依赖）、2NF范式（消除部分函数依赖）、3NF范式（消除传递性函数依赖），了解关系数据库理论的概念、数据依赖、函数依赖的逻辑蕴含。",
        keyPoints: "函数依赖、范式和规范化、第三范式、BCNF 范式",
        keyPointsCount: 4
    },
    { 
        id: 5, 
        name: "数据库设计", 
        row: 1, 
        col: 0,
        description: "要求学生掌握数据库设计的基本步骤、概念结构设计的特点、E-R模型的特点、基本步骤、数据字典的内容，以及数据库设计各个阶段的设计目标、具体设计内容、设计描述、设计方法等知识点。",
        keyPoints: "需求分析、概念结构设计、逻辑结构设计、物理结构",
        keyPointsCount: 4
    },
    { 
        id: 6, 
        name: "SQL Server 系统概述", 
        row: 1, 
        col: 1,
        description: "要求学生了解SQL Server的发展历史，SQL Server的安装与配置，关系数据库的基础知识，以及SQL Server的基本特点、数据库的组成部分、组件方案、组件管理、系统与服务器安全、数据库的对象、使用SQL Server的安全性等知识。",
        keyPoints: "SQL Server 的安装、SQL Server 的工具和实用程序",
        keyPointsCount: 2
    },
    { 
        id: 7, 
        name: "关系数据库标准语言 SQL", 
        row: 1, 
        col: 2,
        description: "要求学生掌握SQL语言基本语法，为后续操作数据库打好基础。主要包括：SQL语句、更新、删除操作等，库操作语句、表结构、库结构编辑、投影查询、选择查询、连接查询、子查询、聚合及其查询、交集及其查询实现等操作。掌握使用SQL语句操作数据库中的DDL、DCL等子语言，聚合查询、国际查询、SELECT高级查询、复合条件查询、聚合统计查询等。",
        keyPoints: "数据定义语言、数据操作语言、数据查询语言、SQL 程序设计语言、SELECT 高级查询",
        keyPointsCount: 5
    },
    { 
        id: 8, 
        name: "索引", 
        row: 2, 
        col: 0,
        description: "要求学生掌握数据库索引的概念、类别、数据索引的特点、作用、一般索引与唯一索引的区别、复合索引、主键索引、外键索引、聚集索引、非聚集索引等相关概念，掌握索引的创建、物理结构组成、索引规则与约束、查询体系等知识点。",
        keyPoints: "索引类型、创建索引、聚簇索引",
        keyPointsCount: 3
    },
    { 
        id: 9, 
        name: "视图", 
        row: 2, 
        col: 1,
        description: "要求学生掌握数据库视图的基本概念、作用、类别等，包括视图、视图的定义，以及视图的优点、缺点等，掌握视图相关的T-SQL语句用法。",
        keyPoints: "创建视图、使用视图、视图的修改、删除",
        keyPointsCount: 4
    },
    { 
        id: 10, 
        name: "数据库完整性", 
        row: 2, 
        col: 2,
        description: "要求学生了解数据库完整性的概念，掌握数据库完整性实施的手段，包括数据库中的实体完整性、参照完整性、主键约束、外键约束、UNIQUE约束、CHECK约束等，了解数据库完整性的约束、规则、默认值等知识点。",
        keyPoints: "约束、默认值、Primary Key 约束、Foreign key 约束、Check 约束",
        keyPointsCount: 5
    },
    { 
        id: 11, 
        name: "存储过程", 
        row: 2, 
        col: 3,
        description: "要求学生掌握存储过程的概念、特点、作用、分类、参数等，了解存储过程与执行的特点，掌握使用EXECUTE或EXEC语句可执行存储过程。",
        keyPoints: "创建存储过程、行存储过程、存储过程的参数、存储过程的管理",
        keyPointsCount: 4
    },
    { 
        id: 12, 
        name: "触发器", 
        row: 3, 
        col: 0,
        description: "要求学生掌握触发器的概念、分类、特点、作用，掌握INSERT触发器、UPDATE触发器、DELETE触发器的创建和使用，了解触发器的执行机制和事件回溯。",
        keyPoints: "创建 DML 触发器、使用DML 触发器、创建和使用 DDL 触发器、触发器的管理",
        keyPointsCount: 4
    },
    { 
        id: 13, 
        name: "数据库安全性", 
        row: 3, 
        col: 1,
        description: "要求学生掌握数据库安全性的基本知识，了解数据库安全性的措施、授权与收回权限的使用SQL语句，掌握使用GRANT授予权限、使用REVOKE收回权限等知识点。",
        keyPoints: "SQL Server 安全体系结构、SQL Server 的身份验证模式、SQL Server 账号管理、权限和角色",
        keyPointsCount: 4
    },
    { 
        id: 14, 
        name: "数据库备份/恢复", 
        row: 3, 
        col: 2,
        description: "要求学生掌握数据库备份与恢复的基本概念、备份策略、备份类型、完全备份、差异备份、日志备份等知识，了解使用SQL Server Management Studio进行数据库备份和恢复操作、分离/附加操作。",
        keyPoints: "数据备份和恢复、分离和附加用户数据库",
        keyPointsCount: 2
    }
];

// 为每个章节手动定义知识点和题目（根据最新知识点图片 - 22个题目）
// 已移动到数据文件 chapterKnowledgeMap.json
// 数据现在从 /data/chapterKnowledgeMap.json 加载
/* 硬编码数据已移除，改为从JSON文件加载
const chapterKnowledgeMap = {
    1: [], // 第1章 数据库概论 - 无知识点和题目
    
    2: [], // 第2章 数据模型 - 无知识点和题目
    
    3: [ // 第3章 关系数据库
        {
            name: "关系代数",
            questions: [
                { label: "二(1)", score: 4 },
                { label: "二(2)", score: 4 }
            ]
        }
    ],
    
    4: [ // 第4章 关系数据理论
        {
            name: "范式和规范化",
            questions: [
                { label: "一(1)", score: 4 },
                { label: "一(2)", score: 3 },
                { label: "一(3)", score: 3 }
            ]
        }
    ],
    
    5: [ // 第5章 数据库设计
        {
            name: "概念结构设计",
            questions: [
                { label: "四(1)", score: 8 }
            ]
        },
        {
            name: "逻辑结构设计",
            questions: [
                { label: "四(2)", score: 8 }
            ]
        }
    ],
    
    6: [], // 第六章 SQL Server 系统概述 - 无知识点和题目
    
    7: [ // 第7章 关系数据库标准语言 SQL
        {
            name: "数据查询语言",
            questions: [
                { label: "二(3)", score: 4 },
                { label: "二(4)", score: 4 },
                { label: "二(8)", score: 4 }
            ]
        },
        {
            name: "数据操作语言",
            questions: [
                { label: "二(5)", score: 4 },
                { label: "二(6)", score: 4 },
                { label: "二(7)", score: 4 }
            ]
        },
        {
            name: "SQL 程序设计语言",
            questions: [
                { label: "三(4)", score: 4 },
                { label: "三(5)", score: 4 }
            ]
        },
        {
            name: "数据定义语言",
            questions: [
                { label: "三(6)", score: 4 },
                { label: "四(3)", score: 10 }
            ]
        }
    ],
    
    8: [ // 第8章 索引
        {
            name: "索引类型",
            questions: [
                { label: "三(3)", score: 2 } // 4分平均分配给2个知识点
            ]
        },
        {
            name: "创建索引",
            questions: [
                { label: "三(3)", score: 2 } // 4分平均分配给2个知识点
            ]
        }
    ],
    
    9: [ // 第9章 视图
        {
            name: "创建视图",
            questions: [
                { label: "三(7)", score: 4 }
            ]
        }
    ],
    
    10: [ // 第10章 数据库完整性
        {
            name: "约束",
            questions: [
                { label: "四(3)", score: 2 } // 10分平均分配给5个知识点
            ]
        },
        {
            name: "Primary Key约束",
            questions: [
                { label: "四(3)", score: 2 }
            ]
        },
        {
            name: "Foreign Key约束",
            questions: [
                { label: "四(3)", score: 2 }
            ]
        },
        {
            name: "Check约束",
            questions: [
                { label: "四(3)", score: 2 }
            ]
        },
        {
            name: "默认值",
            questions: [
                { label: "四(3)", score: 2 }
            ]
        }
    ],
    
    11: [ // 第11章 存储过程
        {
            name: "创建存储过程",
            questions: [
                { label: "三(1)", score: 2 } // 4分平均分配给2个知识点
            ]
        },
        {
            name: "执行存储过程",
            questions: [
                { label: "三(1)", score: 2 } // 4分平均分配给2个知识点
            ]
        }
    ],
    
    12: [ // 第12章 触发器
        {
            name: "创建 DML 触发器",
            questions: [
                { label: "三(2)", score: 4 }
            ]
        }
    ],
    
    13: [ // 第13章 数据库安全性
        {
            name: "权限和角色",
            questions: [
                { label: "四(4)", score: 4 }
            ]
        }
    ],
    
    14: [] // 第十四章 数据库备份/恢复 - 无知识点和题目
};
*/

// 更新知识点覆盖网格树图（使用 d3.treemap）
function updateKnowledgeGrid() {
    // 列出所有题目的分数和半径（用于调试）
    listAllQuestionScoresAndRadii();
    // 列出所有知识点的分数（用于调试）
    listAllKnowledgePointScores();
    
    const gridContainer = document.querySelector('#knowledge-grid .grid-chart-container');
    if (!gridContainer) {
        console.error('找不到网格树图容器');
        return;
    }
    
    // 清空并重新创建SVG容器
    gridContainer.innerHTML = '';
    
    console.log(`更新网格树图: 14个章节`);
    
    // 创建SVG容器
    const width = gridContainer.offsetWidth || 800;
    const height = gridContainer.offsetHeight || 450;
    
    const svg = d3.select(gridContainer)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .style('background', 'transparent');
    
    // 定义渐变（美化圆圈）
    const defs = svg.append('defs');
    
    // 知识点圆渐变（明亮青色）
    const knowledgeGradient = defs.append('linearGradient')
        .attr('id', 'knowledgeGradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%');
    knowledgeGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#4dd0e1')
        .attr('stop-opacity', 1);
    knowledgeGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#26c6da')
        .attr('stop-opacity', 1);
    
    // 题目圆渐变（橙红色）
    const questionGradient = defs.append('linearGradient')
        .attr('id', 'questionGradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%');
    questionGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#FF7F24')
        .attr('stop-opacity', 1);
    questionGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#E66A00')
        .attr('stop-opacity', 1);
    
    // 蓝色覆盖度渐变：覆盖越多颜色越深
    const coverageColorScale = d3.scaleLinear()
        .domain([0, 0.2, 0.4, 0.6, 0.8, 1])
        .range(['#F0F8FF', '#E6F3FF', '#B3D9FF', '#8CC5FF', '#52A5F7', '#1565C0'])
        .clamp(true);
    
    // 为每个章节分配知识点并计算总分
    chapterData.forEach(chapter => {
        chapter.knowledgePoints = chapterKnowledgeMap[chapter.id] || [];
        // 计算章节总分
        chapter.totalScore = 0;
        chapter.knowledgePoints.forEach(kp => {
            kp.questions.forEach(q => {
                chapter.totalScore += q.score;
            });
        });
        
        // 计算实际考察的知识点数量
        const actualKnowledgeCount = chapter.knowledgePoints.length;
        const requiredKeyPoints = chapter.keyPointsCount || 0;
        
        // 依据覆盖率（相对于考纲重点）生成蓝色深浅
        const totalKeyPoints = Math.max(requiredKeyPoints, 1);
        const coverageRatio = Math.min(actualKnowledgeCount / totalKeyPoints, 1);
        chapter.coverageRatio = coverageRatio;
        chapter.color = coverageColorScale(coverageRatio);
        chapter.textColor = coverageRatio >= 0.6 ? '#f4f7ff' : '#0b1a33';
        
        // 达标判定：实际知识点数 >= 重点数 × chapterComplianceRatio
        chapter.isMet = actualKnowledgeCount >= requiredKeyPoints * chapterComplianceRatio;
    });
    
    // 为分数为0的章节设置一个小的默认值，确保它们也能显示
    chapterData.forEach(chapter => {
        if (chapter.totalScore === 0) {
            chapter.value = 1; // 设置最小值
        } else {
            chapter.value = chapter.totalScore;
        }
    });
    
    // 构建树形数据结构
    const hierarchyData = {
        name: "试卷知识点覆盖",
        children: chapterData.map(chapter => ({
            id: chapter.id,
            name: chapter.name,
            value: chapter.value,
            totalScore: chapter.totalScore,
            color: chapter.color,
            textColor: chapter.textColor,
            description: chapter.description,
            keyPoints: chapter.keyPoints,
            knowledgePoints: chapter.knowledgePoints
        }))
    };
    
    // 创建树形层次结构
    const root = d3.hierarchy(hierarchyData)
        .sum(d => d.value)
        .sort((a, b) => b.value - a.value); // 按分数从大到小排序
    
    // 创建 treemap 布局
    const treemap = d3.treemap()
        .size([width, height])
        .paddingInner(3)
        .paddingOuter(3)
        .round(true);
    
    // 应用布局
    treemap(root);
    
    // 绘制每个章节
    const nodes = svg.selectAll('g')
        .data(root.leaves())
        .enter()
        .append('g')
        .attr('transform', d => `translate(${d.x0},${d.y0})`);
    
    // 章节背景矩形（美化：阴影、渐变、hover效果）
    nodes.append('rect')
        .attr('width', d => d.x1 - d.x0)
        .attr('height', d => d.y1 - d.y0)
        .attr('fill', d => d.data.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 3)
        .attr('rx', 6)
        .attr('ry', 6)
        .style('cursor', 'pointer')
        .style('filter', 'drop-shadow(1px 1px 3px rgba(0,0,0,0.08))')
        .style('transition', 'all 0.3s ease')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .style('filter', 'drop-shadow(2px 2px 8px rgba(0,0,0,0.15))')
                .attr('stroke-width', 4)
                .style('opacity', 0.95);
        })
        .on('mouseout', function(event, d) {
            d3.select(this)
                .style('filter', 'drop-shadow(1px 1px 3px rgba(0,0,0,0.08))')
                .attr('stroke-width', 3)
                .style('opacity', 1);
        })
        .on('click', (event, d) => {
            showChapterDescription(d.data);
        });
    
    // 清空题目位置记录
    window.questionPositions = {};
    
    // 绘制知识点圆和题目圆（先绘制，在下层）
    // 注意：标题在最上层，圆可以与标题区域重叠
    nodes.each(function(d) {
        if (d.data.knowledgePoints && d.data.knowledgePoints.length > 0 && d.data.totalScore > 0) {
            const cellWidth = d.x1 - d.x0;
            const cellHeight = d.y1 - d.y0;
            const contentArea = {
                x: 5,           // 左右边距减小
                y: 5,           // 顶部边距减小（标题在上层，不怕重叠）
                width: cellWidth - 10,   // 更大的可用宽度
                height: cellHeight - 10  // 更大的可用高度
            };
            
            drawKnowledgeCircles(d3.select(this), d.data.knowledgePoints, contentArea, d.data, d);
        }
    });
    
    // 在所有章节绘制完成后，绘制跨章节的弧线连接
    drawCrossChapterArcs(svg, nodes);
    
    // 章节标题（最后绘制，在最上层）
    // 先绘制白色描边作为背景，增强可读性
    nodes.append('text')
        .attr('class', 'chapter-title chapter-title-stroke')
        .attr('x', d => (d.x1 - d.x0) / 2)
        .attr('y', d => {
            const cellHeight = d.y1 - d.y0;
            // 小网格时标题垂直居中偏上
            if (d.data.totalScore === 0) return Math.min(cellHeight * 0.35, cellHeight - 2);
            return 18;
        })
        .attr('text-anchor', 'middle')
        .attr('fill', 'none')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', d => d.data.totalScore === 0 ? 1 : 3)
        .attr('font-size', d => d.data.totalScore === 0 ? '4px' : '12px')
        .attr('font-weight', '900')
        .text(d => `第${d.data.id}章 ${d.data.name}`)
        .style('pointer-events', 'none')
        .style('paint-order', 'stroke');
    
    // Draw black text on top
    nodes.append('text')
        .attr('class', 'chapter-title chapter-title-fill')
        .attr('x', d => (d.x1 - d.x0) / 2)
        .attr('y', d => {
            const cellHeight = d.y1 - d.y0;
            // Small grid: title vertically centered above
            if (d.data.totalScore === 0) return Math.min(cellHeight * 0.35, cellHeight - 2);
            return 18;
        })
        .attr('text-anchor', 'middle')
        .attr('fill', '#000000')
        .attr('font-size', d => d.data.totalScore === 0 ? '4px' : '12px')
        .attr('font-weight', '900')
        .text(d => `第${d.data.id}章 ${d.data.name}`)
        .style('pointer-events', 'none')
        .style('text-shadow', '1px 1px 2px rgba(255,255,255,0.8)');

    // Auto-shrink chapter titles if they overflow the cell width (especially for long English names)
    // We keep a minimum font size to avoid making the title unreadable.
    nodes.each(function(d) {
        try {
            if (!d || !d.data || d.data.totalScore === 0) return;
            const cellWidth = d.x1 - d.x0;
            const maxWidth = Math.max(10, cellWidth - 12); // padding
            const g = d3.select(this);
            const fillText = g.select('text.chapter-title-fill');
            const strokeText = g.select('text.chapter-title-stroke');
            if (fillText.empty() || strokeText.empty()) return;

            const fillNode = fillText.node();
            // Start from current font-size (default 12px)
            let size = parseFloat(fillText.attr('font-size')) || 12;
            const minSize = 6;

            // Shrink until it fits
            while (size > minSize && fillNode.getComputedTextLength() > maxWidth) {
                size -= 1;
                fillText.attr('font-size', `${size}px`);
                strokeText.attr('font-size', `${size}px`);
            }
        } catch (e) {
            // If measurement fails in some browsers, just keep default size.
        }
    });
    
    // 添加覆盖百分比显示（在章节标题下方）
    // 先绘制白色描边背景
    nodes.append('text')
        .attr('x', d => (d.x1 - d.x0) / 2)
        .attr('y', d => {
            const cellHeight = d.y1 - d.y0;
            // 小网格时覆盖率文字垂直居中偏下
            if (d.data.totalScore === 0) return Math.min(cellHeight * 0.65, cellHeight - 2);
            return 33;
        })
        .attr('text-anchor', 'middle')
        .attr('fill', 'none')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', d => d.data.totalScore === 0 ? 1 : 3)
        .attr('font-size', d => {
            // 覆盖为0的章节使用更小的字体
            if (d.data.totalScore === 0) return '4px';
            const cellWidth = d.x1 - d.x0;
            return cellWidth < 80 ? '9px' : '11px';
        })
        .attr('font-weight', '600')
        .text(d => {
            const chapter = chapterData.find(c => c.id === d.data.id);
            if (chapter && chapter.coverageRatio !== undefined) {
                return `${(chapter.coverageRatio * 100).toFixed(0)}%`;
            }
            return '';
        })
        .style('pointer-events', 'none')
        .style('paint-order', 'stroke');
    
    // 再绘制覆盖百分比文字
    nodes.append('text')
        .attr('x', d => (d.x1 - d.x0) / 2)
        .attr('y', d => {
            const cellHeight = d.y1 - d.y0;
            // 小网格时覆盖率文字垂直居中偏下
            if (d.data.totalScore === 0) return Math.min(cellHeight * 0.65, cellHeight - 2);
            return 33;
        })
        .attr('text-anchor', 'middle')
        .attr('fill', d => {
            const chapter = chapterData.find(c => c.id === d.data.id);
            if (chapter) {
                // 达标 → 普通深色，不达标 → 红色警示
                return chapter.isMet ? '#333333' : '#d32f2f';
            }
            return '#666666';
        })
        .attr('font-size', d => {
            // 覆盖为0的章节使用更小的字体
            if (d.data.totalScore === 0) return '4px';
            const cellWidth = d.x1 - d.x0;
            return cellWidth < 80 ? '9px' : '11px';
        })
        .attr('font-weight', '600')
        .text(d => {
            const chapter = chapterData.find(c => c.id === d.data.id);
            if (chapter && chapter.coverageRatio !== undefined) {
                return `${(chapter.coverageRatio * 100).toFixed(0)}%`;
            }
            return '';
        })
        .style('pointer-events', 'none')
        .style('text-shadow', '1px 1px 2px rgba(255,255,255,0.8)');
    
    // 🌟 检查并标记预览题目的章节
    highlightPreviewChapterInTreemap(svg, root);
    
    console.log('网格树图更新完成');
}

// 在 Treemap 中高亮预览题目所属的章节
function highlightPreviewChapterInTreemap(svg, root) {
    // 移除旧的预览标记
    svg.selectAll('.preview-chapter-highlight').remove();
    
    // 检查是否有预览题目
    if (!previewQuestionForView || !previewQuestionForView.chapterId) {
        return;
    }
    
    const targetChapterId = previewQuestionForView.chapterId;
    console.log(`🎯 在 Treemap 中高亮章节 ${targetChapterId}`);
    
    // 找到对应章节的节点
    const targetNode = root.leaves().find(d => d.data.id === targetChapterId);
    if (!targetNode) {
        console.log(`⚠️ 未找到章节 ${targetChapterId} 的节点`);
        return;
    }
    
    const x = targetNode.x0;
    const y = targetNode.y0;
    const width = targetNode.x1 - targetNode.x0;
    const height = targetNode.y1 - targetNode.y0;
    
    // 添加高亮边框
    const highlightGroup = svg.append('g')
        .attr('class', 'preview-chapter-highlight')
        .attr('transform', `translate(${x}, ${y})`);
    
    // 金色发光边框
    highlightGroup.append('rect')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'none')
        .attr('stroke', '#FFD700')
        .attr('stroke-width', 4)
        .attr('rx', 8)
        .attr('ry', 8)
        .style('filter', 'drop-shadow(0 0 10px rgba(255, 215, 0, 0.8))')
        .style('animation', 'treemap-highlight-pulse 1.5s ease-in-out infinite');
    
    // 添加"新题目"标签
    const labelWidth = 80;
    const labelHeight = 24;
    const labelX = width / 2 - labelWidth / 2;
    const labelY = height / 2 - labelHeight / 2;
    
    highlightGroup.append('rect')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('width', labelWidth)
        .attr('height', labelHeight)
        .attr('fill', '#FFD700')
        .attr('rx', 12)
        .attr('ry', 12)
        .style('filter', 'drop-shadow(0 0 5px rgba(255, 165, 0, 0.6))');
    
    highlightGroup.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2 + 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#333')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text('+ 新题目');
}

// 显示章节描述（点击章节网格时）
function showChapterDescription(chapter) {
    const contentDisplay = document.getElementById('chapter-content-display');
    if (!contentDisplay) return;
    
    let html = `
        <div class="chapter-detail">
            <h5>第 ${chapter.id} 章：${chapter.name}</h5>
            <div class="chapter-description">
                <p><strong>要求：</strong>${chapter.description}</p>`;
    
    if (chapter.keyPoints) {
        html += `<p><strong>关键知识点：</strong>${chapter.keyPoints}</p>`;
    }
    
    html += `
            </div>
        </div>
    `;
    
    contentDisplay.innerHTML = html;
}

// 简化知识点名称
function getShortKnowledgeName(fullName) {
    if (!fullName) return '';
    // 移除章节编号，只保留核心名称
    const parts = fullName.split('.');
    if (parts.length > 1) {
        return parts[parts.length - 1].trim().substring(0, 8);
    }
    return fullName.substring(0, 8);
}

// 根据圆的半径计算可以容纳的最大字符数（中英文不同字符宽度估算）
function getMaxCharsForCircle(radius, fontSize, text = '') {
    // 圆的直径
    const diameter = radius * 2;
    // 留出边距（约20%）
    const usableDiameter = diameter * 0.8;
    
    // 估算字符宽度：
    // - 中文/全角：更宽
    // - 英文/数字：更窄
    const hasCjk = /[\u4e00-\u9fff]/.test(text);
    const charWidth = hasCjk ? (fontSize * 1.1) : (fontSize * 0.6);
    
    // 计算可以容纳的字符数（考虑边距）
    const maxChars = Math.floor(usableDiameter / charWidth);
    return Math.max(2, maxChars); // 至少2个字符
}

// 处理知识点圆中的文字，确保不溢出圆
// 如果文字太长，先尝试换行，如果还是太长则缩小字体
function formatTextForCircle(text, radius, fontSize, x, y, textElement) {
    if (!text) return;
    
    const textLength = text.length;
    let currentFontSize = fontSize;
    let maxCharsPerLine = getMaxCharsForCircle(radius, currentFontSize, text);
    
    // 如果文字很短，直接显示
    if (textLength <= maxCharsPerLine) {
        textElement.attr('font-size', `${currentFontSize}px`);
        textElement.text(text);
        return;
    }
    
    // 尝试换行显示（最多两行）
    const maxCharsForTwoLines = maxCharsPerLine * 2;
    if (textLength <= maxCharsForTwoLines) {
        // 可以分两行显示
        const midPoint = Math.ceil(textLength / 2);
        textElement.attr('font-size', `${currentFontSize}px`);
        textElement.text('');
        textElement.append('tspan')
            .attr('x', x)
            .attr('dy', '-0.35em')
            .text(text.substring(0, midPoint));
        textElement.append('tspan')
            .attr('x', x)
            .attr('dy', '1.2em')
            .text(text.substring(midPoint));
        return;
    }
    
    // 文字太长，尝试缩小字体
    const minFontSize = Math.max(6, fontSize * 0.6);
    
    for (let scale = 0.9; scale >= 0.6; scale -= 0.1) {
        currentFontSize = fontSize * scale;
        maxCharsPerLine = getMaxCharsForCircle(radius, currentFontSize, text);
        const maxCharsForTwoLines = maxCharsPerLine * 2;
        
        if (textLength <= maxCharsForTwoLines) {
            const midPoint = Math.ceil(textLength / 2);
            textElement.attr('font-size', `${currentFontSize}px`);
            textElement.text('');
            textElement.append('tspan')
                .attr('x', x)
                .attr('dy', '-0.35em')
                .text(text.substring(0, midPoint));
            textElement.append('tspan')
                .attr('x', x)
                .attr('dy', '1.2em')
                .text(text.substring(midPoint));
            return;
        }
    }
    
    // 文字实在太长，使用省略号截断
    currentFontSize = minFontSize;
    maxCharsPerLine = getMaxCharsForCircle(radius, currentFontSize, text);
    textElement.attr('font-size', `${currentFontSize}px`);
    textElement.text('');
    
    // 第一行正常显示
    const line1 = text.substring(0, maxCharsPerLine);
    // 第二行截断并加省略号
    const remaining = text.substring(maxCharsPerLine);
    const line2MaxChars = Math.max(maxCharsPerLine - 2, 3); // 留出省略号空间
    const line2 = remaining.length > line2MaxChars 
        ? remaining.substring(0, line2MaxChars) + '..'
        : remaining;
    
    textElement.append('tspan')
        .attr('x', x)
        .attr('dy', '-0.35em')
        .text(line1);
    textElement.append('tspan')
        .attr('x', x)
        .attr('dy', '1.2em')
        .text(line2);
}

// 转换数字为中文
function convertToChineseNum(num) {
    const chineseNums = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];
    return chineseNums[num] || num;
}

// 题目分数映射表（题目圆大小严格按照原始分数）
let questionScoreMap = {};
function rebuildQuestionScoreMap() {
    questionScoreMap = {};
    if (!questionContentMap || typeof questionContentMap !== 'object') return;
    Object.keys(questionContentMap).forEach(qId => {
        const qInfo = questionContentMap[qId];
        if (!qInfo || qInfo.score == null) return;
        const rawScore = qInfo.score;
        let score;
        if (typeof rawScore === 'number') {
            score = rawScore;
        } else {
            const match = String(rawScore).match(/(\d+)/);
            score = match ? parseInt(match[1]) : 0;
        }
        questionScoreMap[qInfo.label] = score;
    });
    console.log(`questionScoreMap rebuilt: ${Object.keys(questionScoreMap).length} entries`);
}
rebuildQuestionScoreMap();

// 统计每个题目在所有章节中出现的知识点数量
function getQuestionKnowledgeCount(questionLabel) {
    let count = 0;
    Object.keys(chapterKnowledgeMap).forEach(chapterId => {
        const knowledgePoints = chapterKnowledgeMap[chapterId] || [];
        knowledgePoints.forEach(kp => {
            kp.questions.forEach(q => {
                if (q.label === questionLabel) {
                    count++;
                }
            });
        });
    });
    return count;
}

// 从questionContentMap获取题目原始分数
function getQuestionOriginalScore(questionLabel) {
    // 先尝试直接查找
    if (questionScoreMap[questionLabel]) {
        return questionScoreMap[questionLabel];
    }
    
    // 如果找不到，尝试转换格式：将"一(1)"转换为"一、（1）"
    const normalizedLabel = questionLabel.replace(/\((\d+)\)/g, '、（$1）');
    if (questionScoreMap[normalizedLabel]) {
        return questionScoreMap[normalizedLabel];
    }
    
    // 如果还是找不到，尝试反向转换：将"一、（1）"转换为"一(1)"
    // 使用字符串替换避免正则表达式问题
    const reverseLabel = questionLabel.replace(/、/g, '').replace(/（/g, '(').replace(/）/g, ')');
    if (questionScoreMap[reverseLabel]) {
        return questionScoreMap[reverseLabel];
    }
    
    // 如果都找不到，尝试通过labelToQuestionId映射
    if (labelToQuestionId[questionLabel]) {
        const qId = labelToQuestionId[questionLabel];
        const qInfo = questionContentMap[qId];
        if (qInfo && qInfo.score != null) {
            if (typeof qInfo.score === 'number') return qInfo.score;
            const match = String(qInfo.score).match(/(\d+)/);
            return match ? parseInt(match[1]) : 0;
        }
    }
    
    return 0;
}

// 计算题目圆的大小（严格按照题目原始分数，不受其他因素影响）
// 使用面积计算：面积与分数成正比，半径与面积的平方根成正比
function getQuestionCircleRadius(questionLabel) {
    const questionScore = getQuestionOriginalScore(questionLabel);
    // 按面积比例计算：面积 = π * r^2，所以 r = sqrt(面积/π)
    // 如果面积与分数成正比，那么 r = baseRadius * sqrt(分数/基准分数)
    // 4分为基准，基准半径 = 10
    // 10分题目：面积是4分题目的 10/4 = 2.5倍，半径 = 10 * sqrt(10/4) = 10 * sqrt(2.5) ≈ 15.8
    // 8分题目：面积是4分题目的 8/4 = 2倍，半径 = 10 * sqrt(8/4) = 10 * sqrt(2) ≈ 14.1
    // 3分题目：面积是4分题目的 3/4 = 0.75倍，半径 = 10 * sqrt(3/4) = 10 * sqrt(0.75) ≈ 8.7
    const baseRadius = 10; // 4分题目的基准半径
    const radius = baseRadius * Math.sqrt(questionScore / 4) * (4/3); // 放大1/3（即4/3倍）
    // 确保最小半径为5.3像素（4 * 4/3）
    const finalRadius = Math.max(radius, 5.3);
    
    // 调试信息（可以在控制台查看）
    if (window.debugQuestionRadius) {
        const area = Math.PI * finalRadius * finalRadius;
        console.log(`题目 ${questionLabel}: 分数=${questionScore}, 半径=${finalRadius.toFixed(1)}, 面积=${area.toFixed(1)}`);
    }
    
    return finalRadius;
}

// 列出所有题目的分数和半径（用于调试）
function listAllQuestionScoresAndRadii() {
    console.log('=== 所有题目的分数和半径 ===');
    const results = [];
    Object.keys(questionContentMap).forEach(qId => {
        const qInfo = questionContentMap[qId];
        const label = qInfo.label;
        const score = getQuestionOriginalScore(label);
        const radius = getQuestionCircleRadius(label);
        results.push({
            label: label,
            score: score,
            radius: radius.toFixed(1)
        });
        console.log(`题目 ${label}: 分数=${score}分, 半径=${radius.toFixed(1)}px`);
    });
    console.log('=== 统计 ===');
    console.log(`总题目数: ${results.length}`);
    console.log(`分数范围: ${Math.min(...results.map(r => r.score))} - ${Math.max(...results.map(r => r.score))}`);
    console.log(`半径范围: ${Math.min(...results.map(r => parseFloat(r.radius))).toFixed(1)} - ${Math.max(...results.map(r => parseFloat(r.radius))).toFixed(1)}`);
    return results;
}

// 列出所有知识点的分数（用于调试）
function listAllKnowledgePointScores() {
    console.log('=== 所有知识点的分数 ===');
    Object.keys(chapterKnowledgeMap).forEach(chapterId => {
        const knowledgePoints = chapterKnowledgeMap[chapterId] || [];
        if (knowledgePoints.length > 0) {
            console.log(`\n章节 ${chapterId}:`);
            knowledgePoints.forEach(kp => {
                const score = getKnowledgePointScore(kp);
                const knowledgeCount = kp.questions ? kp.questions.length : 0;
                const questionLabels = kp.questions ? kp.questions.map(q => q.label).join(', ') : '';
                console.log(`  知识点 "${kp.name}": 分数=${score.toFixed(2)}, 题目数=${knowledgeCount}, 题目=${questionLabels}`);
            });
        }
    });
}

// 计算知识点圆的分数（新规则）
// 规则：
// 1. 如果题目在所有章节中是唯一的（只关联这一个知识点），题目全部分数加到知识点
// 2. 如果题目不唯一（关联多个知识点），分数 = 题目分数 / 相关联的知识点个数
// 3. 把这两种题目的分数相加就是知识点圆的分数
function getKnowledgePointScore(knowledgePoint) {
    if (!knowledgePoint || !knowledgePoint.questions || knowledgePoint.questions.length === 0) {
        return 0;
    }
    let totalScore = 0;
    knowledgePoint.questions.forEach(q => {
        if (q && q.label) {
            const questionOriginalScore = getQuestionOriginalScore(q.label);
            if (questionOriginalScore <= 0) {
                return; // 跳过分数为0的题目
            }
            
            // 统计该题目在所有章节中出现的知识点数量
            const knowledgeCount = getQuestionKnowledgeCount(q.label);
            
            // 判断题目是否唯一（只关联一个知识点）
            if (knowledgeCount === 1) {
                // 题目唯一，全部分数加到知识点
                totalScore += questionOriginalScore;
            } else if (knowledgeCount > 1) {
                // 题目不唯一，分数 = 题目分数 / 知识点个数
                const scorePerKnowledge = questionOriginalScore / knowledgeCount;
                totalScore += scorePerKnowledge;
            }
        }
    });
    return totalScore || 0;
}

// 绘制跨章节的弧线连接（连接不同章节下同一个题目）
function drawCrossChapterArcs(svg, nodes) {
    if (!window.questionPositions) return;
    
    // 先清除之前的弧线
    svg.selectAll('.cross-chapter-arcs').remove();
    
    // 创建一个新的图层用于绘制跨章节弧线
    // 注意：不要放在最底层，否则可能被章节背景遮挡
    const arcLayer = svg.append('g')
        .attr('class', 'cross-chapter-arcs')
        .style('pointer-events', 'none');
    
    Object.keys(window.questionPositions).forEach(questionLabel => {
        const positions = window.questionPositions[questionLabel];
        if (positions.length < 2) return; // 只有出现在多个章节的题目才需要连接
        
        console.log(`[跨章节弧线] 题目 ${questionLabel} 出现在 ${positions.length} 个章节:`, positions.map(p => `章节${p.chapterId}`).join(', '));
        
        // 按章节ID排序，确保连接顺序一致
        positions.sort((a, b) => a.chapterId - b.chapterId);
        
        // 链式连接：只连接相邻的位置（n个圆只需要n-1条线）
        for (let i = 0; i < positions.length - 1; i++) {
                const pos1 = positions[i];
            const pos2 = positions[i + 1];
                
                // 使用存储的坐标（已经是相对于SVG的全局坐标）
                const x1 = pos1.x;
                const y1 = pos1.y;
                const x2 = pos2.x;
                const y2 = pos2.y;
                
                console.log(`[跨章节弧线] 连接章节${pos1.chapterId}(${x1.toFixed(1)},${y1.toFixed(1)}) 和 章节${pos2.chapterId}(${x2.toFixed(1)},${y2.toFixed(1)})`);
                
                // 绘制弧线（使用贝塞尔曲线，向上弯曲）
                const midX = (x1 + x2) / 2;
                const midY = Math.min(y1, y2) - 40; // 弧线向上弯曲
                
                const path = `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
                
                arcLayer.append('path')
                    .attr('d', path)
                    .attr('fill', 'none')
                    .attr('stroke', 'white')
                    .attr('stroke-width', 3)
                    .attr('opacity', 0.7)
                    .attr('class', `cross-chapter-arc-${questionLabel}`);
        }
    });
    
    console.log(`[跨章节弧线] 总共绘制了 ${arcLayer.selectAll('path').size()} 条弧线`);
}

// 在单元格中绘制知识点圆和题目圆（大小根据分数动态变化）
function drawKnowledgeCircles(cell, knowledgePoints, contentArea, chapterInfo, nodeData) {
    const g = cell.append('g')
        .attr('transform', `translate(${contentArea.x}, ${contentArea.y})`);
    
    // 动态检测：多个知识点是否对应同一个题目（不再硬编码章节ID）
    let sharedQuestion = null;
    let sharedQuestionOriginalScore = 0;
    let sharedQuestionKnowledgeCount = 0;
    
    if (knowledgePoints.length > 1) {
        // 检查所有知识点是否对应同一个题目
        const firstQuestion = knowledgePoints[0].questions && knowledgePoints[0].questions[0];
        if (firstQuestion) {
        const allSameQuestion = knowledgePoints.every(kp => 
                kp.questions && kp.questions.length === 1 && kp.questions[0].label === firstQuestion.label
        );
        
        if (allSameQuestion) {
            sharedQuestion = firstQuestion;
            // 获取题目原始分数
            sharedQuestionOriginalScore = getQuestionOriginalScore(sharedQuestion.label);
            // 统计该题目在所有章节中的知识点数量
            sharedQuestionKnowledgeCount = getQuestionKnowledgeCount(sharedQuestion.label);
            }
        }
    }
    
    // 如果多个知识点对应同一个题目，使用环绕布局（动态判断，不再硬编码章节）
    if (sharedQuestion) {
        const centerX = contentArea.width / 2;
        const centerY = contentArea.height / 2;
        
        // 计算可用空间的最大半径
        const maxAvailableRadius = Math.min(contentArea.width, contentArea.height) / 2 - 5;
        
        // 使用固定基准计算题目圆半径（确保相同分数大小一致）
        const questionRadius = getQuestionCircleRadius(sharedQuestion.label);
        const numKps = knowledgePoints.length;
        console.log(`[绘制] 环绕布局 章节 ${chapterInfo.id} - 题目 ${sharedQuestion.label}: 分数=${getQuestionOriginalScore(sharedQuestion.label)}, 半径=${questionRadius.toFixed(1)}`);
        
        // 绘制题目圆（在中心）
        const qGroup = g.append('g');
        qGroup.append('circle')
            .attr('cx', centerX)
            .attr('cy', centerY)
            .attr('r', questionRadius)
            .attr('fill', 'url(#questionGradient)')
            .attr('stroke', '#FFE4B5')
            .attr('stroke-width', 2)
            .style('filter', 'drop-shadow(1px 1px 2px rgba(0,0,0,0.1))');
        
        // 题目分数文字（显示原始分数）
        const scoreFontSize = Math.max(12, questionRadius * 1.2);
        qGroup.append('text')
            .attr('x', centerX)
            .attr('y', centerY)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', `${scoreFontSize}px`)
            .attr('font-weight', 'bold')
            .attr('opacity', 0.4)
            .text(sharedQuestionOriginalScore);
        
        // 题目序号
        const labelFontSize = Math.max(7, questionRadius / 2.5);
        qGroup.append('text')
            .attr('x', centerX)
            .attr('y', centerY)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', `${labelFontSize}px`)
            .attr('font-weight', 'bold')
            .text(sharedQuestion.label);
        
        // 题目圆点击事件
        qGroup.style('cursor', 'pointer')
            .on('click', (event) => {
                event.stopPropagation();
                showQuestionDetail(sharedQuestion, chapterInfo);
            });
        
        // 计算每个知识点圆的分数和半径（使用固定基准，确保一致性）
        const FIXED_KP_BASE_RADIUS = 20; // 固定基准半径：4分对应20像素
        let maxKpRadius = 8;
    knowledgePoints.forEach(kp => {
            kp.totalScore = getKnowledgePointScore(kp);
            const kpScore = kp.totalScore || 0;
            // 使用固定基准计算半径
            let kpRadius = kpScore <= 0 ? 8 : FIXED_KP_BASE_RADIUS * Math.sqrt(Math.max(kpScore, 0.5) / 4);
            kpRadius = Math.max(kpRadius, 8);
            kp.radius = kpRadius;
            maxKpRadius = Math.max(maxKpRadius, kpRadius);
        });
        
        // 存储题目信息用于跨章节弧线连接
        if (!window.questionPositions) {
            window.questionPositions = {};
        }
        if (!window.questionPositions[sharedQuestion.label]) {
            window.questionPositions[sharedQuestion.label] = [];
        }
        
        // 计算相对于SVG的全局坐标（需要nodeData）
        const globalCenterX = (nodeData && nodeData.x0 !== undefined ? nodeData.x0 : 0) + centerX + contentArea.x;
        const globalCenterY = (nodeData && nodeData.y0 !== undefined ? nodeData.y0 : 0) + centerY + contentArea.y;
        
        const questionPosEntry = {
            chapterId: chapterInfo.id,
            x: globalCenterX,
            y: globalCenterY,
            radius: questionRadius,
            kpPositions: []
        };
        window.questionPositions[sharedQuestion.label].push(questionPosEntry);
        
        // 知识点圆环绕题目圆（使用最大半径计算轨道）
        const orbitRadius = questionRadius + maxKpRadius + 5;
        
        // 检查函数：判断位置是否有效（不溢出边界）
        const isValidPosition = (x, y, r) => {
            return x - r >= 0 && x + r <= contentArea.width &&
                   y - r >= 0 && y + r <= contentArea.height;
        };
        
        // 存储知识点圆的位置，用于绘制弧线
        const kpPositions = [];
        
        knowledgePoints.forEach((kp, i) => {
            const currentKpRadius = kp.radius || 8;
            const baseAngle = (i / knowledgePoints.length) * 2 * Math.PI - Math.PI / 2;
            
            // 尝试找到有效位置
            let kpX, kpY;
            let foundValidPosition = false;
            
            // 首先尝试基于初始角度的位置
            kpX = centerX + Math.cos(baseAngle) * orbitRadius;
            kpY = centerY + Math.sin(baseAngle) * orbitRadius;
            
            if (isValidPosition(kpX, kpY, currentKpRadius)) {
                foundValidPosition = true;
            } else {
                // 尝试缩小轨道半径
                const reducedOrbit = Math.min(orbitRadius, maxAvailableRadius - currentKpRadius - 2);
                kpX = centerX + Math.cos(baseAngle) * reducedOrbit;
                kpY = centerY + Math.sin(baseAngle) * reducedOrbit;
                if (isValidPosition(kpX, kpY, currentKpRadius)) {
                    foundValidPosition = true;
                }
            }
            
            // 最后兜底：限制在边界内
            if (!foundValidPosition) {
                kpX = Math.max(currentKpRadius + 1, Math.min(contentArea.width - currentKpRadius - 1, kpX));
                kpY = Math.max(currentKpRadius + 1, Math.min(contentArea.height - currentKpRadius - 1, kpY));
            }
            
            kpPositions.push({ x: kpX, y: kpY, angle: baseAngle });
            
            // 存储知识点位置用于跨章节弧线连接
            const questionPos = window.questionPositions[sharedQuestion.label];
            if (questionPos && questionPos.length > 0) {
                const globalKpX = (nodeData && nodeData.x0 !== undefined ? nodeData.x0 : 0) + kpX + contentArea.x;
                const globalKpY = (nodeData && nodeData.y0 !== undefined ? nodeData.y0 : 0) + kpY + contentArea.y;
                
                questionPos[questionPos.length - 1].kpPositions.push({
                    x: globalKpX,
                    y: globalKpY,
                    chapterId: chapterInfo.id
                });
            }
            const kpGroup = g.append('g');
            kpGroup.append('circle')
                .attr('cx', kpX)
                .attr('cy', kpY)
                .attr('r', currentKpRadius)
                .attr('fill', 'url(#knowledgeGradient)')
                .attr('stroke', '#e0f7fa')
                .attr('stroke-width', 2.5)
                .style('filter', 'drop-shadow(1px 1px 3px rgba(0,0,0,0.1))');
            
            // 知识点名称（确保不溢出圆）
            const nameFontSize = Math.max(8, currentKpRadius / 2.5);
            const nameText = kpGroup.append('text')
                .attr('x', kpX)
                .attr('y', kpY)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', '#fff')
                .attr('font-size', `${nameFontSize}px`)
                .attr('font-weight', 'bold');
            
            // 格式化文字，确保不溢出圆
            formatTextForCircle(kp.name, currentKpRadius, nameFontSize, kpX, kpY, nameText);
            
            // 点击事件
            kpGroup.style('cursor', 'pointer')
                .on('click', () => {
                    const detailInfo = {
                        chapterName: `第${chapterInfo.id}章 ${chapterInfo.name}`,
                        knowledgeName: kp.name,
                        questionCount: 1,
                        questions: [sharedQuestion]
                    };
                    showKnowledgeDetailWithChapter(detailInfo);
                });
        });
        
        // 不再绘制同一章节内知识点圆之间的弧线
        // 只保留跨章节相同题目圆的连接弧线（在drawCrossChapterArcs函数中绘制）
        
        return; // 特殊布局完成，直接返回
    }
    
    // 原有的布局逻辑（其他章节）
    knowledgePoints.forEach(kp => {
        kp.totalScore = getKnowledgePointScore(kp);
    });
    
    // 计算网格参数
    const cols = Math.ceil(Math.sqrt(knowledgePoints.length));
    const rows = Math.ceil(knowledgePoints.length / cols);
    const cellW = contentArea.width / cols;
    const cellH = contentArea.height / rows;
    
    // 动态缩放：估算所需面积 vs 可用面积，空间不足时自动缩小圆
    var FIXED_BASE_RADIUS = 20;
    var scaleFactor = 1.0;
    
    var totalCircleCount = 0;
    var estimatedAreaNeeded = 0;
    knowledgePoints.forEach(kp => {
        var kpScore = kp.totalScore || 0;
        var kpR = kpScore <= 0 ? 8 : FIXED_BASE_RADIUS * Math.sqrt(Math.max(kpScore, 0.5) / 4);
        kpR = Math.max(kpR, 8);
        estimatedAreaNeeded += Math.PI * kpR * kpR;
        totalCircleCount++;
        (kp.questions || []).forEach(q => {
            var qR = getQuestionCircleRadius(q.label);
            estimatedAreaNeeded += Math.PI * qR * qR;
            totalCircleCount++;
        });
    });
    
    // 加上圆之间的间距空间（每个圆周围需要 gap 空间）
    var availableArea = contentArea.width * contentArea.height;
    // 圆的实际占用面积约为 estimatedAreaNeeded 的 3~4 倍（考虑间距和轨道）
    var effectiveAreaNeeded = estimatedAreaNeeded * 3.5;
    
    if (effectiveAreaNeeded > availableArea && totalCircleCount > 2) {
        scaleFactor = Math.sqrt(availableArea / effectiveAreaNeeded);
        scaleFactor = Math.max(scaleFactor, 0.4);
        FIXED_BASE_RADIUS = 20 * scaleFactor;
        console.log(`[动态缩放] 章节 ${chapterInfo.id}: 可用面积=${availableArea.toFixed(0)}, 所需面积=${effectiveAreaNeeded.toFixed(0)}, 缩放因子=${scaleFactor.toFixed(2)}`);
    }
    
    // ===== 智能布局算法 =====
    // 记录所有已放置的圆
    const placedCircles = [];
    
    // 检查两个圆是否碰撞（间距随缩放因子调整）
    var MIN_KP_GAP = Math.max(4, Math.round(15 * scaleFactor));
    var MIN_CIRCLE_GAP = Math.max(1, Math.round(2 * scaleFactor));
    const checkCollision = (x1, y1, r1, x2, y2, r2, gap = MIN_CIRCLE_GAP) => {
        const dx = x1 - x2;
        const dy = y1 - y2;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < (r1 + r2 + gap);
    };
    
    // 检查一个圆是否与已放置的圆碰撞（可排除某些圆）
    // isKp: 当前要放置的是否是知识点圆
    const hasCollisionExcluding = (x, y, r, excludeIds = [], isKp = false) => {
        for (const circle of placedCircles) {
            if (excludeIds.includes(circle.id)) continue;
            // 如果两个都是知识点圆，使用更大的间距
            const gap = (isKp && circle.type === 'kp') ? MIN_KP_GAP : MIN_CIRCLE_GAP;
            if (checkCollision(x, y, r, circle.x, circle.y, circle.r, gap)) {
                return true;
            }
        }
        return false;
    };
    
    // 检查位置是否在边界内
    const isInBounds = (x, y, r) => {
        return x - r >= 0 && x + r <= contentArea.width &&
               y - r >= 0 && y + r <= contentArea.height;
    };
    
    // 检查位置是否有效（边界内且不碰撞）
    // isKp: 当前要放置的是否是知识点圆（知识点圆之间需要更大间距）
    const isValidPosition = (x, y, r, excludeIds = [], isKp = false) => {
        return isInBounds(x, y, r) && !hasCollisionExcluding(x, y, r, excludeIds, isKp);
    };
    
    // 方向列表：24个方向均匀分布
    const directions = [];
    for (let i = 0; i < 24; i++) {
        directions.push((i / 24) * 2 * Math.PI);
    }
    
    // 计算所有知识点和题目的信息
    const kpInfoList = knowledgePoints.map((kp, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const defaultCx = col * cellW + cellW / 2;
        const defaultCy = row * cellH + cellH / 2;
        
        let kpRadius = kp.totalScore <= 0 ? 8 : FIXED_BASE_RADIUS * Math.sqrt(Math.max(kp.totalScore, 0.5) / 4);
        kpRadius = Math.max(kpRadius, 8);
        
        const questions = (kp.questions || []).map(q => ({
            ...q,
            radius: getQuestionCircleRadius(q.label) * scaleFactor
        }));
        
        return {
            kp,
            index: i,
            col,
            row,
            defaultCx,
            defaultCy,
            cx: defaultCx,
            cy: defaultCy,
            kpRadius,
            questions,
            questionPositions: [] // 将存储每个题目的最终位置
        };
    });
    
    // 特殊处理：第一章节3个知识点时，大圆在左上，两个小圆在右下和右上
    const isChapter1With3Kps = chapterInfo && chapterInfo.id === 1 && kpInfoList.length === 3;
    
    // 为每个知识点找到最佳位置（知识点圆 + 所有题目圆都不碰撞）
    kpInfoList.forEach((kpInfo, kpIndex) => {
        const { kpRadius, questions, col, row } = kpInfo;
        
        // 知识点圆的移动范围（在自己的网格单元内）
        const cellCenterX = col * cellW + cellW / 2;
        const cellCenterY = row * cellH + cellH / 2;
        const maxOffsetX = cellW / 2 - kpRadius - 5;
        const maxOffsetY = cellH / 2 - kpRadius - 5;
        
        // 生成知识点圆的候选位置
        let kpCandidates = [];
        
        // 第一章节3个知识点的特殊布局
        if (isChapter1With3Kps) {
            const kpName = kpInfo.kp.name;
            if (kpName === "极限计算") {
                // 最大的圆：左上
                kpCandidates = [{ 
                    x: cellCenterX - maxOffsetX * 0.4, 
                    y: cellCenterY - maxOffsetY * 0.4 
                }];
            } else if (kpName === "函数连续性与间断点") {
                // 函数连续性与间断点：右下（强制位置，即使碰撞也要尝试）
                const targetX = cellCenterX + maxOffsetX * 0.6; // 从0.4改为0.6，更靠右
                const targetY = cellCenterY + maxOffsetY * 0.4;
                kpCandidates = [{ x: targetX, y: targetY }];
                console.log(`[第一章节布局] 函数连续性与间断点: 目标位置=(${targetX.toFixed(1)}, ${targetY.toFixed(1)}), maxOffsetX=${maxOffsetX.toFixed(1)}, maxOffsetY=${maxOffsetY.toFixed(1)}, cellCenter=(${cellCenterX.toFixed(1)}, ${cellCenterY.toFixed(1)})`);
            } else {
                // 无穷小量比较：右上
                kpCandidates = [{ 
                    x: cellCenterX + maxOffsetX * 0.4, 
                    y: cellCenterY - maxOffsetY * 0.4 
                }];
            }
        } else {
            // 默认布局：中心位置 + 偏移位置
            kpCandidates = [{ x: cellCenterX, y: cellCenterY }]; // 默认位置
            
            // 添加偏移位置
            const offsets = [
                { dx: 0, dy: -maxOffsetY * 0.5 },  // 上
                { dx: 0, dy: maxOffsetY * 0.5 },   // 下
                { dx: -maxOffsetX * 0.5, dy: 0 },  // 左
                { dx: maxOffsetX * 0.5, dy: 0 },   // 右
                { dx: -maxOffsetX * 0.4, dy: -maxOffsetY * 0.4 }, // 左上
                { dx: maxOffsetX * 0.4, dy: -maxOffsetY * 0.4 },  // 右上
                { dx: -maxOffsetX * 0.4, dy: maxOffsetY * 0.4 },  // 左下
                { dx: maxOffsetX * 0.4, dy: maxOffsetY * 0.4 },   // 右下
            ];
            
            for (const offset of offsets) {
                const x = cellCenterX + offset.dx;
                const y = cellCenterY + offset.dy;
                if (isInBounds(x, y, kpRadius)) {
                    kpCandidates.push({ x, y });
                }
            }
        }
        
        // 尝试每个知识点候选位置
        let bestLayout = null;
        let bestScore = -1;
        
        for (const kpCandidate of kpCandidates) {
            const kpX = kpCandidate.x;
            const kpY = kpCandidate.y;
            
            // 检查知识点圆是否与已放置的圆碰撞（知识点圆之间需要更大间距）
            if (!isValidPosition(kpX, kpY, kpRadius, [], true)) {
                if (isChapter1With3Kps && kpInfo.kp.name === "函数连续性与间断点") {
                    console.log(`[第一章节布局] 函数连续性与间断点: 位置(${kpX.toFixed(1)}, ${kpY.toFixed(1)})碰撞检测失败，已放置的圆数量=${placedCircles.length}`);
                }
                continue;
            }
            
            // 尝试放置所有题目圆
            const tempQuestionPositions = [];
            let allQuestionsPlaced = true;
            
            // 临时添加知识点圆用于题目圆的碰撞检测
            const tempKpCircle = { id: `temp_kp_${kpIndex}`, x: kpX, y: kpY, r: kpRadius, type: 'kp' };
            placedCircles.push(tempKpCircle);
            
            for (let qi = 0; qi < questions.length; qi++) {
                const q = questions[qi];
                const questionRadius = q.radius;
                const baseOrbitRadius = kpRadius + questionRadius + 3;
                
                // 计算初始角度
                let baseAngle;
                if (questions.length === 1) {
                    baseAngle = Math.PI / 2;
                } else if (questions.length === 2) {
                    baseAngle = qi === 0 ? Math.PI : 0;
        } else {
                    baseAngle = (qi / questions.length) * 2 * Math.PI - Math.PI / 2;
                }
                
                // 尝试找到有效位置
                let qx, qy;
                let found = false;
                
                // 临时添加之前的题目圆
                const tempQCircles = tempQuestionPositions.map((pos, idx) => ({
                    id: `temp_q_${kpIndex}_${idx}`,
                    x: pos.x,
                    y: pos.y,
                    r: pos.r
                }));
                tempQCircles.forEach(c => placedCircles.push(c));
                
                // 尝试不同轨道半径和方向
                const orbitRadii = [baseOrbitRadius, baseOrbitRadius * 1.2, baseOrbitRadius * 1.5, baseOrbitRadius * 0.9];
                
                outerLoop:
                for (const orbit of orbitRadii) {
                    // 先尝试初始角度
                    qx = kpX + Math.cos(baseAngle) * orbit;
                    qy = kpY + Math.sin(baseAngle) * orbit;
                    if (isValidPosition(qx, qy, questionRadius)) {
                        found = true;
                        break outerLoop;
                    }
                    
                    // 尝试其他方向
                    for (const dir of directions) {
                        qx = kpX + Math.cos(dir) * orbit;
                        qy = kpY + Math.sin(dir) * orbit;
                        if (isValidPosition(qx, qy, questionRadius)) {
                            found = true;
                            break outerLoop;
                        }
                    }
                }
                
                // 移除临时题目圆
                tempQCircles.forEach(c => {
                    const idx = placedCircles.findIndex(p => p.id === c.id);
                    if (idx !== -1) placedCircles.splice(idx, 1);
                });
                
                if (found) {
                    tempQuestionPositions.push({ x: qx, y: qy, r: questionRadius, q });
                } else {
                    allQuestionsPlaced = false;
                    break;
                }
            }
            
            // 移除临时知识点圆
            const tempIdx = placedCircles.findIndex(p => p.id === tempKpCircle.id);
            if (tempIdx !== -1) placedCircles.splice(tempIdx, 1);
            
            // 评估这个布局
            if (allQuestionsPlaced) {
                const score = questions.length; // 成功放置的题目数
                if (score > bestScore) {
                    bestScore = score;
                    bestLayout = {
                        kpX,
                        kpY,
                        questionPositions: tempQuestionPositions
                    };
                }
            }
        }
        
        // 如果找到有效布局，使用它
        if (bestLayout) {
            kpInfo.cx = bestLayout.kpX;
            kpInfo.cy = bestLayout.kpY;
            kpInfo.questionPositions = bestLayout.questionPositions;
            
            // 正式添加知识点圆
            placedCircles.push({ x: kpInfo.cx, y: kpInfo.cy, r: kpRadius, type: 'kp', kpIndex });
            
            // 正式添加题目圆
            bestLayout.questionPositions.forEach((pos, qi) => {
                placedCircles.push({ x: pos.x, y: pos.y, r: pos.r, type: 'q', kpIndex, qIndex: qi });
            });
        } else {
            // 没有找到完美布局
            // 对于第一章节的特殊布局，即使题目圆无法完美放置，也要使用指定位置
            if (isChapter1With3Kps && kpCandidates.length > 0) {
                const forcedCandidate = kpCandidates[0];
                console.log(`[第一章节布局] ${kpInfo.kp.name}: 所有候选位置失败，强制使用指定位置(${forcedCandidate.x.toFixed(1)}, ${forcedCandidate.y.toFixed(1)})`);
                kpInfo.cx = forcedCandidate.x;
                kpInfo.cy = forcedCandidate.y;
            } else {
                // 使用默认位置并尽力放置题目
                kpInfo.cx = kpInfo.defaultCx;
                kpInfo.cy = kpInfo.defaultCy;
            }
            
            placedCircles.push({ x: kpInfo.cx, y: kpInfo.cy, r: kpRadius, type: 'kp', kpIndex });
            
            // 尽力放置题目圆
            for (let qi = 0; qi < questions.length; qi++) {
                const q = questions[qi];
                const questionRadius = q.radius;
                const baseOrbitRadius = kpRadius + questionRadius + 3;
                
                let baseAngle = questions.length === 1 ? Math.PI / 2 : 
                               (questions.length === 2 ? (qi === 0 ? Math.PI : 0) :
                                (qi / questions.length) * 2 * Math.PI - Math.PI / 2);
                
                let qx = kpInfo.cx + Math.cos(baseAngle) * baseOrbitRadius;
                let qy = kpInfo.cy + Math.sin(baseAngle) * baseOrbitRadius;
                
                // 尝试找有效位置
                let found = false;
                for (const orbit of [baseOrbitRadius, baseOrbitRadius * 1.3, baseOrbitRadius * 1.6]) {
                    if (found) break;
                    for (const dir of directions) {
                        const tx = kpInfo.cx + Math.cos(dir) * orbit;
                        const ty = kpInfo.cy + Math.sin(dir) * orbit;
                        if (isValidPosition(tx, ty, questionRadius)) {
                            qx = tx;
                            qy = ty;
                            found = true;
                            break;
                        }
                    }
                }
                
                // 边界限制
                qx = Math.max(questionRadius + 1, Math.min(contentArea.width - questionRadius - 1, qx));
                qy = Math.max(questionRadius + 1, Math.min(contentArea.height - questionRadius - 1, qy));
                
                kpInfo.questionPositions.push({ x: qx, y: qy, r: questionRadius, q });
                placedCircles.push({ x: qx, y: qy, r: questionRadius, type: 'q', kpIndex, qIndex: qi });
            }
        }
    });
    
    // ===== 绘制所有圆 =====
    kpInfoList.forEach((kpInfo) => {
        const { cx, cy, kpRadius, kp, questionPositions } = kpInfo;
        const questions = kp.questions || [];
        const numQuestions = questions.length;
        
        // 绘制题目圆
        questionPositions.forEach((pos, qi) => {
            const q = pos.q;
            const qx = pos.x;
            const qy = pos.y;
            const questionRadius = pos.r;
            
            console.log(`[绘制] 章节 ${chapterInfo.id} - 题目 ${q.label}: 位置=(${qx.toFixed(1)}, ${qy.toFixed(1)}), 半径=${questionRadius.toFixed(1)}`);
            
            // 存储题目位置用于跨章节弧线连接
                if (!window.questionPositions) {
                    window.questionPositions = {};
                }
                if (!window.questionPositions[q.label]) {
                    window.questionPositions[q.label] = [];
                }
                
                // 计算相对于SVG的全局坐标
                const globalX = (nodeData && nodeData.x0 !== undefined ? nodeData.x0 : 0) + qx + contentArea.x;
                const globalY = (nodeData && nodeData.y0 !== undefined ? nodeData.y0 : 0) + qy + contentArea.y;
                
                window.questionPositions[q.label].push({
                    chapterId: chapterInfo.id,
                    x: globalX,
                    y: globalY,
                    radius: questionRadius
                });
                
                // 题目圆背景
                const qGroup = g.append('g');
                
                qGroup.append('circle')
                    .attr('cx', qx)
                    .attr('cy', qy)
                    .attr('r', questionRadius)
                    .attr('fill', 'url(#questionGradient)')
                    .attr('stroke', '#FFE4B5')
                    .attr('stroke-width', 2)
                    .style('filter', 'drop-shadow(1px 1px 2px rgba(0,0,0,0.1))');
                
            // 分数背景文字
                const scoreFontSize = Math.max(12, questionRadius * 1.2);
                qGroup.append('text')
                    .attr('x', qx)
                    .attr('y', qy)
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'middle')
                    .attr('fill', '#fff')
                    .attr('font-size', `${scoreFontSize}px`)
                    .attr('font-weight', 'bold')
                    .attr('opacity', 0.4)
                    .text(q.score);
                
            // 题目序号
                const labelFontSize = Math.max(7, questionRadius / 2.5);
                qGroup.append('text')
                    .attr('x', qx)
                    .attr('y', qy)
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'middle')
                    .attr('fill', '#fff')
                    .attr('font-size', `${labelFontSize}px`)
                    .attr('font-weight', 'bold')
                    .text(q.label);
                
            // 题目圆点击事件
                qGroup.style('cursor', 'pointer')
                    .on('click', (event) => {
                    event.stopPropagation();
                        showQuestionDetail(q, chapterInfo);
                    });
            });
        
        // 绘制知识点圆（在题目圆之上）
        const kpGroup = g.append('g');
        
        kpGroup.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', kpRadius)
            .attr('fill', 'url(#knowledgeGradient)')
            .attr('stroke', '#e0f7fa')
            .attr('stroke-width', 2.5)
            .style('filter', 'drop-shadow(1px 1px 3px rgba(0,0,0,0.1))');
        
        // 知识点名称（字体大小根据圆的大小调整，确保不溢出圆）
        const nameFontSize = Math.max(8, kpRadius / 2.5);
        const nameText = kpGroup.append('text')
            .attr('x', cx)
            .attr('y', cy)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', `${nameFontSize}px`)
            .attr('font-weight', 'bold');
        
        // 格式化文字，确保不溢出圆
        formatTextForCircle(kp.name, kpRadius, nameFontSize, cx, cy, nameText);
        
        // 点击事件 - 显示知识点详情
        kpGroup.style('cursor', 'pointer')
            .on('click', () => {
                const detailInfo = {
                    chapterName: `第${chapterInfo.id}章 ${chapterInfo.name}`,
                    knowledgeName: kp.name,
                    questionCount: numQuestions,
                    questions: questions
                };
                showKnowledgeDetailWithChapter(detailInfo);
            });
    });
}

// 显示知识点详情（包含章节信息）
function showKnowledgeDetailWithChapter(detailInfo) {
    const contentDisplay = document.getElementById('chapter-content-display');
    if (!contentDisplay) return;
    
    const questions = Array.isArray(detailInfo.questions) ? detailInfo.questions : [];
    const itemsHtml = questions.map((q) => {
        const label = q?.label ?? '';
        const questionId = labelToQuestionId?.[label];
        const contentObj = questionId ? questionContentMap?.[questionId] : null;
        const score = contentObj?.score ?? q?.score ?? '';
        const text = contentObj?.content ?? '';
        return `
            <div style="padding: 10px 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; margin-top: 8px;">
                <div style="display:flex; gap:10px; align-items: baseline;">
                    <div style="font-weight:700; color:#0f766e;">${label || 'Q'}</div>
                    <div style="margin-left:auto; color:#ef4444; font-weight:700;">${score}</div>
                </div>
                <div style="margin-top: 6px; color:#374151; font-size: 13px; line-height: 1.6;">
                    ${text || ''}
                </div>
            </div>
        `;
    }).join('');
    
    let html = `
        <div style="padding: 16px 18px; border-left: 4px solid #5fa3a3; background: #f9fafb;">
            <div style="font-size: 18px; color: #333; font-weight: 600; margin-bottom: 6px;">
                ${detailInfo.knowledgeName || '知识点'}
            </div>
            <div style="font-size: 13px; color: #6b7280; margin-bottom: 10px;">
                ${detailInfo.chapterName || ''}
            </div>
            <div style="font-size: 13px; color: #374151;">
                关联题目数：<span style="color: #0f766e; font-weight: 700;">${detailInfo.questionCount ?? questions.length ?? 0}</span>
            </div>
            ${itemsHtml ? `<div style="margin-top: 10px;">${itemsHtml}</div>` : `<div style="margin-top: 10px; color:#6b7280; font-size: 12px;">暂无关联题目。</div>`}
        </div>
    `;
    
    contentDisplay.innerHTML = html;
}

// 显示题目详情（点击题目圆时）
function showQuestionDetail(question, chapterInfo) {
    const contentDisplay = document.getElementById('chapter-content-display');
    if (!contentDisplay) return;
    
    // 从树图的label转换为questionId，然后获取题目内容
    const questionId = labelToQuestionId[question.label];
    const content = questionContentMap[questionId];
    
    // 🎯 高亮平行集合图中该题目的路径
    highlightQuestionPathInPHP(questionId);
    
    if (!content) {
        console.error('未找到题目内容：', question.label, questionId);
        return;
    }
    
    // Find related knowledge points in this chapter
    const kps = (chapterKnowledgeMap && chapterInfo?.id != null)
        ? (chapterKnowledgeMap[chapterInfo.id] || [])
        : [];
    const relatedKpNames = (kps || [])
        .filter(kp => (kp?.questions || []).some(q => q?.label === question.label))
        .map(kp => kp?.name)
        .filter(Boolean);
    const kpHtml = relatedKpNames.length
        ? `<div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #d1d5db;">
                <div style="font-size: 12px; color:#6b7280; font-weight: 700; margin-bottom: 6px;">关联知识点</div>
                <div style="display:flex; flex-wrap: wrap; gap: 6px;">
                    ${relatedKpNames.map(n => `<span style="font-size: 12px; background:#ecfeff; color:#0f766e; border:1px solid #a5f3fc; padding: 2px 8px; border-radius: 999px;">${n}</span>`).join('')}
                </div>
           </div>`
        : '';
    
    let html = `
        <div style="padding: 20px; border-left: 4px solid #6ba3c4; background: #f9fafb;">
            <div style="display: flex; align-items: baseline; margin-bottom: 12px;">
                <div style="font-size: 16px; color: #6ba3c4; font-weight: 600; margin-right: 12px;">
                    ${content.label}
                </div>
                <div style="flex-grow: 1; font-size: 13px; color: #999;">
                    第${chapterInfo.id}章 · ${chapterInfo.name}
                </div>
                <div style="font-size: 15px; color: #ff6b6b; font-weight: 600;">
                    ${content.score}
                </div>
            </div>
            <div style="color: #555; font-size: 14px; line-height: 1.7;">
                ${content.content}
            </div>
            ${kpHtml}
        </div>
    `;
    
    contentDisplay.innerHTML = html;
}

// 显示知识点详情
function showKnowledgeDetail(syllabusPoint, examPointIds, examPoints) {
    const contentDisplay = document.getElementById('chapter-content-display');
    if (!contentDisplay) return;
    
    const relatedExamPoints = examPoints.filter(p => examPointIds.includes(p.id));
    let html = `<h4>${syllabusPoint.name}</h4>`;
    html += `<p>${syllabusPoint.description || ''}</p>`;
    html += `<ul>`;
    relatedExamPoints.forEach(point => {
        html += `<li>${point.name}</li>`;
    });
    html += `</ul>`;
    
    contentDisplay.innerHTML = html;
}

// 更新知识点覆盖折线图
function updateKnowledgeLineChart() {
    const actualLine = document.getElementById('actual-pk-line');
    const keyPointsLine = document.getElementById('key-points-line');
    const dataPoints = document.getElementById('data-points');
    const chartAxes = document.getElementById('chart-axes');
    const yAxisLabels = document.getElementById('y-axis-labels');
    const xAxisLabels = document.getElementById('x-axis-labels');
    const gridLines = document.getElementById('grid-lines');
    
    if (!actualLine || !keyPointsLine || !dataPoints) {
        console.error('找不到折线图元素');
        return;
    }
    
    console.log('更新知识点覆盖折线图，当前视图:', currentCoverageView);
    
    // ============ 按当前覆盖视图准备折线图原始数据 ============
    const rawActuals  = chapterData.map(ch => (chapterKnowledgeMap[ch.id] || []).length);
    const rawRequired = chapterData.map(ch => ch.keyPointsCount || 0);
    
    // 由 currentCoverageView 决定两条折线展示什么
    let actualPoints, keyPoints;
    let legendPrimaryText, legendSecondaryText;
    let secondaryDashArray = '5,5';
    let secondaryStroke   = '#ff6384';

    if (currentCoverageView === 'compliance-rate') {
        // 重点达成率：蓝实线=每章实际知识点数；橙虚线=达标阈值（重点 × complianceRatio）
        actualPoints       = rawActuals.slice();
        keyPoints          = rawRequired.map(r => +(r * chapterComplianceRatio).toFixed(2));
        legendPrimaryText  = '实线：每章实际知识点数';
        legendSecondaryText = `虚线：达标阈值（重点 × ${Math.round(chapterComplianceRatio * 100)}%）`;
        secondaryStroke    = '#ff9800';
    } else if (currentCoverageView === 'keypoint-rate') {
        // 知识点达成率：蓝实线=每章实际知识点数；橙虚线=达标阈值（总知识点 × knowledgePointComplianceRatio）
        const rawTotalKP   = chapterData.map(ch => getChapterTotalKnowledgePoints(ch));
        actualPoints       = rawActuals.slice();
        keyPoints          = rawTotalKP.map(t => +(t * knowledgePointComplianceRatio).toFixed(2));
        legendPrimaryText  = '实线：每章实际知识点数';
        legendSecondaryText = `虚线：达标阈值（总知识点 × ${Math.round(knowledgePointComplianceRatio * 100)}%）`;
        secondaryStroke    = '#ff9800';
    } else {
        // 章节覆盖率（默认）：蓝实线=每章实际知识点数；粉虚线=每章重点知识点数
        actualPoints       = rawActuals.slice();
        keyPoints          = rawRequired.slice();
        legendPrimaryText  = '实线：每章实际知识点数';
        legendSecondaryText = '虚线：每章重点知识点数';
    }

    // 同步更新图例文字与色块
    const legendPrimaryEl   = document.getElementById('line-legend-primary-text');
    const legendSecondaryEl = document.getElementById('line-legend-secondary-text');
    if (legendPrimaryEl)   legendPrimaryEl.textContent = legendPrimaryText;
    if (legendSecondaryEl) legendSecondaryEl.textContent = legendSecondaryText;
    const legendSecondarySwatch = document.getElementById('line-legend-secondary-swatch');
    if (legendSecondarySwatch) {
        legendSecondarySwatch.style.background = secondaryStroke;
        legendSecondarySwatch.style.backgroundImage =
            `repeating-linear-gradient(90deg, ${secondaryStroke} 0px, ${secondaryStroke} 2px, transparent 2px, transparent 4px)`;
    }
    
    // 动态计算Y轴最大值（取实际值和重点数量的最大值，向上取整到最近的整数+1）
    const maxActual = Math.max(...actualPoints, 0);
    const maxKeyPoints = Math.max(...keyPoints, 0);
    const yMax = Math.max(Math.ceil(maxActual), Math.ceil(maxKeyPoints), 6) + 1; // 至少6，留一点余量
    
    // 动态计算X轴参数
    const numChapters = chapterData.length;
    const xBase = 45; // X轴起点（留出Y轴标签空间）
    const xEnd = 390; // X轴终点
    const chartWidth = xEnd - xBase; // 可用宽度
    const xStep = numChapters > 1 ? chartWidth / (numChapters - 1) : chartWidth;
    
    // 绘制坐标轴
    const yBase = 180; // Y轴底部（X轴位置）
    const yTop = 20;   // Y轴顶部
    const yHeight = yBase - yTop;
    const yScale = yHeight / yMax; // 每个单位的像素数
    
    // Y轴X坐标（固定位置）
    const yAxisX = 40;
    
    // 清空并重绘网格线
    if (gridLines) {
        gridLines.innerHTML = '';
        // 水平网格线（Y轴刻度对应）
        for (let i = 0; i <= yMax; i++) {
            const yPos = yBase - (i * yScale);
            const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            gridLine.setAttribute('x1', yAxisX);
            gridLine.setAttribute('y1', yPos);
            gridLine.setAttribute('x2', xEnd);
            gridLine.setAttribute('y2', yPos);
            gridLine.setAttribute('stroke', '#e0e0e0');
            gridLine.setAttribute('stroke-width', '1');
            gridLine.setAttribute('stroke-dasharray', '2,2');
            gridLines.appendChild(gridLine);
        }
        // 垂直网格线（X轴刻度对应）
        chapterData.forEach((chapter, index) => {
            const xPos = xBase + index * xStep;
            const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            gridLine.setAttribute('x1', xPos);
            gridLine.setAttribute('y1', yTop);
            gridLine.setAttribute('x2', xPos);
            gridLine.setAttribute('y2', yBase);
            gridLine.setAttribute('stroke', '#e0e0e0');
            gridLine.setAttribute('stroke-width', '1');
            gridLine.setAttribute('stroke-dasharray', '2,2');
            gridLines.appendChild(gridLine);
        });
    }
    
    // 清空并重绘坐标轴
    if (chartAxes) {
        chartAxes.innerHTML = '';
        // Y轴
        const yAxisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxisLine.setAttribute('x1', yAxisX);
        yAxisLine.setAttribute('y1', yTop);
        yAxisLine.setAttribute('x2', yAxisX);
        yAxisLine.setAttribute('y2', yBase);
        yAxisLine.setAttribute('stroke', '#333');
        yAxisLine.setAttribute('stroke-width', '1');
        chartAxes.appendChild(yAxisLine);
        
        // X轴
        const xAxisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        xAxisLine.setAttribute('x1', yAxisX);
        xAxisLine.setAttribute('y1', yBase);
        xAxisLine.setAttribute('x2', xEnd);
        xAxisLine.setAttribute('y2', yBase);
        xAxisLine.setAttribute('stroke', '#333');
        xAxisLine.setAttribute('stroke-width', '1');
        chartAxes.appendChild(xAxisLine);
    }
    
    // 动态生成Y轴标签和刻度
    if (yAxisLabels) {
        yAxisLabels.innerHTML = '';
        for (let i = 0; i <= yMax; i++) {
            const yPos = yBase - (i * yScale);
            
            // Y轴刻度线
            const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            tick.setAttribute('x1', yAxisX - 4);
            tick.setAttribute('y1', yPos);
            tick.setAttribute('x2', yAxisX);
            tick.setAttribute('y2', yPos);
            tick.setAttribute('stroke', '#333');
            tick.setAttribute('stroke-width', '1');
            yAxisLabels.appendChild(tick);
            
            // Y轴标签
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', yAxisX - 7);
            label.setAttribute('y', yPos + 4);
            label.setAttribute('text-anchor', 'end');
            label.setAttribute('class', 'axis-label');
            label.setAttribute('font-size', '10px');
            label.setAttribute('fill', '#333');
            label.textContent = i;
            yAxisLabels.appendChild(label);
        }
    }
    
    // 动态生成X轴标签和刻度
    if (xAxisLabels) {
        xAxisLabels.innerHTML = '';
        chapterData.forEach((chapter, index) => {
            const xPos = xBase + index * xStep;
            
            // X轴刻度线
            const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            tick.setAttribute('x1', xPos);
            tick.setAttribute('y1', yBase);
            tick.setAttribute('x2', xPos);
            tick.setAttribute('y2', yBase + 4);
            tick.setAttribute('stroke', '#333');
            tick.setAttribute('stroke-width', '1');
            xAxisLabels.appendChild(tick);
            
            // X轴标签
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', xPos);
            label.setAttribute('y', yBase + 15);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('class', 'axis-label');
            // 根据章节数量调整字体大小
            const fontSize = numChapters > 14 ? '7px' : (numChapters > 10 ? '8px' : '10px');
            label.setAttribute('font-size', fontSize);
            label.setAttribute('fill', '#333');
            label.textContent = `K${chapter.id}`;
            xAxisLabels.appendChild(label);
        });
    }
    
    // 实线 - 实际考核知识点（蓝色直线）
    let actualPointsStr = '';
    actualPoints.forEach((count, index) => {
        const x = xBase + index * xStep;
        const y = yBase - (count * yScale);
        actualPointsStr += `${x},${y} `;
    });
    actualLine.setAttribute('points', actualPointsStr.trim());
    actualLine.setAttribute('stroke', '#2196f3');
    actualLine.setAttribute('stroke-width', '2');
    actualLine.setAttribute('fill', 'none');
    
    // 虚线 - 章节重点数量（红色虚线）
    let keyPointsStr = '';
    keyPoints.forEach((count, index) => {
        const x = xBase + index * xStep;
        const y = yBase - (count * yScale);
        keyPointsStr += `${x},${y} `;
    });
    keyPointsLine.setAttribute('points', keyPointsStr.trim());
    keyPointsLine.setAttribute('stroke', secondaryStroke);
    keyPointsLine.setAttribute('stroke-width', '2');
    keyPointsLine.setAttribute('stroke-dasharray', secondaryDashArray);
    keyPointsLine.setAttribute('fill', 'none');
    
    // 数据点（蓝色实心圆点 - 实线）
    dataPoints.innerHTML = '';
    actualPoints.forEach((count, index) => {
        const x = xBase + index * xStep;
        const y = yBase - (count * yScale);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', 3);
        circle.setAttribute('fill', '#2196f3');
        dataPoints.appendChild(circle);
    });
    
    // 虚线数据点（颜色与第二条折线一致）
    keyPoints.forEach((count, index) => {
        const x = xBase + index * xStep;
        const y = yBase - (count * yScale);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', 3);
        circle.setAttribute('fill', secondaryStroke);
        dataPoints.appendChild(circle);
    });
    
    // ============ 按当前视图统计口径 ============
    const totalChapters  = chapterData.length;
    const coveredChapters = rawActuals.filter(c => c > 0).length;                        // 已覆盖章节
    const totalKeyPointsAll = rawRequired.reduce((a, b) => a + b, 0);                    // 重点总数
    const totalActualAll    = rawActuals.reduce((a, b) => a + b, 0);                     // 实际考核知识点总数
    const metChapters = rawActuals.reduce((acc, a, i) =>
        acc + (a >= rawRequired[i] * chapterComplianceRatio ? 1 : 0), 0);                // 达标章节
    const hitKeyPoints = rawActuals.reduce((acc, a, i) =>
        acc + Math.min(a, rawRequired[i]), 0);                                            // 命中的重点知识点

    // 每个视图给出 4 个核心指标卡 + 第二行说明
    let cards = [];
    let footer = '';
    if (currentCoverageView === 'compliance-rate') {
        // 每章覆盖率 = min(1, 实际/重点)；达成率 = 所有章节覆盖率的算术平均
        const chapterRatios = rawActuals.map((a, i) => {
            const req = rawRequired[i];
            if (req <= 0) return 1;            // 重点数=0 视为该章无要求，记 100%
            return Math.min(1, a / req);
        });
        const avgRate = chapterRatios.length > 0
            ? chapterRatios.reduce((s, r) => s + r, 0) / chapterRatios.length
            : 0;
        const rate = avgRate * 100;
        const rateColor = rate >= 60 ? '#4caf50' : (rate >= 40 ? '#ff9800' : '#f44336');
        cards = [
            { label: '章节',     value: totalChapters,   color: '#64b5f6' },
            { label: '已考章节', value: coveredChapters, color: '#42a5f5' },
            { label: '达标章节', value: metChapters,     color: '#ff9800' },
            { label: '达成率',   value: rate.toFixed(1) + '%', color: rateColor, valueColor: rateColor }
        ];
        footer = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 6px; background: #fff; border-radius: 4px; font-size: 10px; color: #555;">
                <span style="font-weight: 600;">达标线：</span>
                <span>实际 ≥ 重点 ×</span>
                <input id="chapter-compliance-input" type="number" min="0" max="100" step="1" value="${Math.round(chapterComplianceRatio * 100)}"
                    style="width: 36px; font-size: 11px; padding: 2px 3px; border: 1px solid #1565c0; border-radius: 3px; text-align: center; font-weight: bold; color: #1565c0; background: #fff;">
                <span>%</span>
            </div>`;
    } else if (currentCoverageView === 'keypoint-rate') {
        // 每章覆盖率 = min(1, 实际/总知识点)；达成率 = 所有章节覆盖率的算术平均
        const rawTotalKP = chapterData.map(ch => getChapterTotalKnowledgePoints(ch));
        const totalKPAll = rawTotalKP.reduce((a, b) => a + b, 0);
        const chapterRatios = rawActuals.map((a, i) => {
            const tot = rawTotalKP[i];
            if (tot <= 0) return 1;
            return Math.min(1, a / tot);
        });
        const avgRate = chapterRatios.length > 0
            ? chapterRatios.reduce((s, r) => s + r, 0) / chapterRatios.length
            : 0;
        const rate = avgRate * 100;
        const rateColor = rate >= 60 ? '#4caf50' : (rate >= 40 ? '#ff9800' : '#f44336');
        const metKPChapters = rawActuals.reduce((acc, a, i) =>
            acc + (a >= rawTotalKP[i] * knowledgePointComplianceRatio ? 1 : 0), 0);
        cards = [
            { label: '章节',       value: totalChapters,  color: '#64b5f6' },
            { label: '总知识点',   value: totalKPAll,     color: '#42a5f5' },
            { label: '达标章节',   value: metKPChapters,  color: '#ff9800' },
            { label: '达成率',     value: rate.toFixed(1) + '%', color: rateColor, valueColor: rateColor }
        ];
        footer = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 6px; background: #fff; border-radius: 4px; font-size: 10px; color: #555;">
                <span style="font-weight: 600;">达标线：</span>
                <span>实际 ≥ 总知识点 ×</span>
                <input id="knowledge-point-compliance-input" type="number" min="0" max="100" step="1" value="${Math.round(knowledgePointComplianceRatio * 100)}"
                    style="width: 36px; font-size: 11px; padding: 2px 3px; border: 1px solid #1565c0; border-radius: 3px; text-align: center; font-weight: bold; color: #1565c0; background: #fff;">
                <span>%</span>
            </div>`;
    } else {
        // chapter-rate
        const rate = totalChapters > 0 ? (coveredChapters / totalChapters) * 100 : 0;
        const rateColor = rate >= 60 ? '#4caf50' : (rate >= 40 ? '#ff9800' : '#f44336');
        cards = [
            { label: '章节',     value: totalChapters,    color: '#64b5f6' },
            { label: '已覆盖',   value: coveredChapters,  color: '#42a5f5' },
            { label: '知识点',   value: totalActualAll,   color: '#ff9800' },
            { label: '覆盖率',   value: rate.toFixed(1) + '%', color: rateColor, valueColor: rateColor }
        ];
        footer = `
            <div style="padding: 4px 6px; background: #fff; border-radius: 4px; font-size: 10px; color: #555; text-align: center;">
                <span style="font-weight: 600;">覆盖率：</span>有考核内容的章节数 / 总章节数 = ${coveredChapters}/${totalChapters}
            </div>`;
    }

    const statsDisplay = document.getElementById('knowledge-stats-display');
    if (statsDisplay) {
        const cardsHtml = cards.map(c => `
            <div style="flex: 1; text-align: center; padding: 4px 2px; background: #fff; border-radius: 4px; border-bottom: 2px solid ${c.color};">
                <span style="color: #666; font-size: 9px; display: block;">${c.label}</span>
                <strong style="color: ${c.valueColor || '#333'}; font-size: 14px;">${c.value}</strong>
            </div>`).join('');
        statsDisplay.innerHTML = `
            <div style="display: flex; justify-content: space-between; gap: 4px; margin-bottom: 4px;">
                ${cardsHtml}
            </div>
            ${footer}
        `;
        // 绑定阈值输入（重点达成率）
        const ratioInput = statsDisplay.querySelector('#chapter-compliance-input');
        if (ratioInput) {
            ratioInput.addEventListener('input', (e) => {
                const raw = parseFloat(e.target.value);
                const clamped = Math.max(0, Math.min(100, isNaN(raw) ? 0 : raw));
                chapterComplianceRatio = clamped / 100;
                updateKnowledgeLineChart();
                updateKnowledgeGrid();
                updateRadarChart();
            });
        }
        // 绑定阈值输入（知识点达成率）
        const kpRatioInput = statsDisplay.querySelector('#knowledge-point-compliance-input');
        if (kpRatioInput) {
            kpRatioInput.addEventListener('input', (e) => {
                const raw = parseFloat(e.target.value);
                const clamped = Math.max(0, Math.min(100, isNaN(raw) ? 0 : raw));
                knowledgePointComplianceRatio = clamped / 100;
                updateKnowledgeLineChart();
                updateRadarChart();
            });
        }
    }
    
    console.log('折线图更新完成', { actualPoints, keyPoints });
}

// 更新认知领域PCP图
function updateCognitiveHeatmap() {
    if (!analysisData || !analysisData.cognitive_dimensions) return;
    
    // 检查D3.js是否已加载
    if (typeof d3 === 'undefined') {
        console.error('D3.js未加载，无法绘制图表');
        return;
    }
    
    const pcpContainer = document.getElementById('pcp-chart-container');
    if (!pcpContainer) return;
    
    const svg = d3.select('#pcp-chart');
    if (svg.empty()) {
        console.error('找不到PCP图表容器');
        return;
    }
    svg.selectAll('*').remove();
    
    const dimensions = analysisData.cognitive_dimensions;
    const keys = Object.keys(dimensions);
    const values = Object.values(dimensions);
    
    const width = 400;
    const height = 300;
    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    
    svg.attr('width', width).attr('height', height);
    
    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
    
    // X轴
    const xScale = d3.scaleBand()
        .domain(keys)
        .range([0, chartWidth])
        .padding(0.1);
    
    // Y轴
    const yScale = d3.scaleLinear()
        .domain([0, 1])
        .range([chartHeight, 0]);
    
    // 绘制条形
    g.selectAll('.bar')
        .data(keys)
        .enter()
        .append('rect')
        .attr('class', 'bar')
        .attr('x', d => xScale(d))
        .attr('y', d => yScale(dimensions[d]))
        .attr('width', xScale.bandwidth())
        .attr('height', d => chartHeight - yScale(dimensions[d]))
        .attr('fill', '#2196f3');
    
    // X轴
    g.append('g')
        .attr('transform', `translate(0,${chartHeight})`)
        .call(d3.axisBottom(xScale));
    
    // Y轴
    g.append('g')
        .call(d3.axisLeft(yScale));
    
    console.log('PCP图更新完成');
}

// 更新认知领域环形图
function updateCognitiveDonutChart() {
    if (!analysisData || !analysisData.cognitive_dimensions) return;
    
    // 检查D3.js是否已加载
    if (typeof d3 === 'undefined') {
        console.error('D3.js未加载，无法绘制图表');
        return;
    }
    
    const svg = d3.select('#dimension-donut-svg');
    if (svg.empty()) {
        console.error('找不到环形图容器');
        return;
    }
    svg.selectAll('*').remove();
    
    const dimensions = analysisData.cognitive_dimensions;
    const data = Object.entries(dimensions).map(([key, value]) => ({
        name: key,
        value: value
    }));
    
    const width = 400;
    const height = 300;
    const radius = Math.min(width, height) / 2 - 20;
    
    const g = svg.append('g')
        .attr('transform', `translate(${width/2},${height/2})`);
    
    const color = d3.scaleOrdinal()
        .domain(data.map(d => d.name))
        .range(['#2196f3', '#4caf50', '#ff9800', '#f44336']);
    
    const pie = d3.pie()
        .value(d => d.value)
        .sort(null);
    
    const arc = d3.arc()
        .innerRadius(radius * 0.6)
        .outerRadius(radius);
    
    const arcs = g.selectAll('.arc')
        .data(pie(data))
        .enter()
        .append('g')
        .attr('class', 'arc');
    
    arcs.append('path')
        .attr('d', arc)
        .attr('fill', d => color(d.data.name));
    
    arcs.append('text')
        .attr('transform', d => `translate(${arc.centroid(d)})`)
        .attr('text-anchor', 'middle')
        .text(d => `${d.data.name}: ${(d.data.value * 100).toFixed(0)}%`);
    
    // 更新统计信息
    const statsDisplay = document.getElementById('cognitive-stats-display');
    if (statsDisplay) {
        const stats = Object.entries(dimensions)
            .map(([key, value]) => `${key}: ${(value * 100).toFixed(0)}%`)
            .join(' | ');
        statsDisplay.textContent = stats;
    }
    
    console.log('认知领域环形图更新完成');
}

// 更新形式规范柱状图
function updateFormatBarChart() {
    const tableBody = document.getElementById('format-table-body');
    if (!tableBody) {
        console.warn('未找到形式规范表格容器');
        return;
    }

    const rows = Array.isArray(formatImprovementData) ? formatImprovementData : [];
    tableBody.innerHTML = '';

    // 固定显示的最小行数
    const MIN_ROWS = 3;

    // 添加实际数据行
    rows.forEach(item => {
        const questionInfo = questionContentMap[item.questionId] || {};
        const tr = document.createElement('tr');

        const columns = [
            questionInfo.label || item.questionId || '--',
            item.original || questionInfo.content || '--',
            item.errorType || '--',
            item.issue || '--',
            item.revised || '--',
            item.improvement || '--'
        ];

        columns.forEach(value => {
            const td = document.createElement('td');
            td.textContent = value;
            tr.appendChild(td);
        });

        tableBody.appendChild(tr);
    });
    
    // 如果数据不足，用 "--" 填充剩余行
    const rowsToAdd = MIN_ROWS - rows.length;
    for (let i = 0; i < rowsToAdd; i++) {
        const tr = document.createElement('tr');
        tr.className = 'empty-row';
        for (let j = 0; j < 6; j++) {
            const td = document.createElement('td');
            td.textContent = '--';
            td.style.color = '#ccc';
            td.style.textAlign = 'center';
            tr.appendChild(td);
        }
        tableBody.appendChild(tr);
    }
    
    // 更新散点图 - 延迟执行确保容器已渲染
    setTimeout(() => {
        updateFormatScatterChart();
    }, 100);
    
    console.log('形式规范表格更新完成');
}

// 更新形式规范直方图（字符数分布）
function updateFormatScatterChart() {
    if (typeof d3 === 'undefined') {
        console.error('D3.js未加载，无法绘制直方图');
        return;
    }
    
    const container = document.getElementById('format-scatter-chart');
    if (!container) {
        console.error('找不到直方图容器');
        return;
    }
    
    // 清空容器
    container.innerHTML = '';
    
    // 统计有错误的题目ID集合
    const errorQuestionIds = new Set();
    formatImprovementData.forEach(item => {
        errorQuestionIds.add(item.questionId);
    });
    
    // 收集22道小题的字符数和错误状态
    const charCounts = [];
    for (let i = 1; i <= 22; i++) {
        const questionId = `Q${i}`;
        const questionInfo = questionContentMap[questionId];
        if (questionInfo && questionInfo.content) {
            const charCount = questionInfo.content.length;
            const hasError = errorQuestionIds.has(questionId);
            charCounts.push({
                questionId: questionId,
                label: questionInfo.label || questionId,
                charCount: charCount,
                hasError: hasError
            });
        }
    }
    
    // 如果没有数据，显示提示
    if (charCounts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #888; padding: 50px;">暂无数据</p>';
        return;
    }
    
    // 计算字符数的范围和区间
    const minChars = d3.min(charCounts, d => d.charCount) || 0;
    const maxChars = d3.max(charCounts, d => d.charCount) || 100;
    
    // 设置区间宽度（根据数据范围自动调整，大约10个区间）
    const binWidth = Math.max(20, Math.ceil((maxChars - minChars) / 10));
    const binCount = Math.ceil((maxChars - minChars) / binWidth) + 1;
    
    // 创建区间并统计频数（总题目数和错误题目数）
    const bins = [];
    for (let i = 0; i < binCount; i++) {
        const binStart = minChars + i * binWidth;
        const binEnd = binStart + binWidth;
        
        let totalCount, errorCount;
        // 最后一个区间包含最大值（使用 <= 而不是 <）
        if (i === binCount - 1) {
            const inRange = charCounts.filter(d => d.charCount >= binStart && d.charCount <= maxChars);
            totalCount = inRange.length;
            errorCount = inRange.filter(d => d.hasError).length;
        } else {
            const inRange = charCounts.filter(d => d.charCount >= binStart && d.charCount < binEnd);
            totalCount = inRange.length;
            errorCount = inRange.filter(d => d.hasError).length;
        }
        
        bins.push({
            x0: binStart,
            x1: binEnd,
            count: totalCount,
            errorCount: errorCount,
            correctCount: totalCount - errorCount
        });
    }
    
    // 移除空的区间（保留至少一个区间）
    const filteredBins = bins.filter(bin => bin.count > 0);
    if (filteredBins.length === 0 && bins.length > 0) {
        // 如果所有区间都是空的，至少保留第一个区间
        filteredBins.push({ ...bins[0], count: 0, errorCount: 0, correctCount: 0 });
    }
    
    console.log('直方图数据:', filteredBins);
    console.log('字符数统计:', charCounts);
    
    // 图表尺寸
    const margin = { top: 20, right: 20, bottom: 60, left: 60 };
    let containerWidth = container.offsetWidth;
    if (!containerWidth || containerWidth === 0) {
        const rect = container.getBoundingClientRect();
        containerWidth = rect.width;
    }
    if (!containerWidth || containerWidth === 0) {
        const parent = container.parentElement;
        if (parent) {
            containerWidth = parent.offsetWidth || parent.getBoundingClientRect().width || 800;
        } else {
            containerWidth = 800;
        }
    }
    const width = Math.max(600, containerWidth - margin.left - margin.right - 40);
    const height = 280 - margin.top - margin.bottom;
    
    // 创建SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
        .style('display', 'block')
        .style('overflow', 'visible');
    
    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
    
    // 计算Y轴的最大值（区间个数）
    const yMax = d3.max(filteredBins, d => d.count) || 1;
    
    // X轴比例尺（字符数）
    const xScale = d3.scaleLinear()
        .domain([minChars, maxChars + binWidth])
        .range([0, width]);
    
    // Y轴比例尺（区间个数）
    const yScale = d3.scaleLinear()
        .domain([0, yMax + 1])
        .range([height, 0]);
    
    // 绘制X轴
    const xAxis = d3.axisBottom(xScale)
        .ticks(Math.min(10, filteredBins.length))
        .tickFormat(d => Math.round(d));
    
    g.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(xAxis)
        .selectAll('text')
        .attr('fill', '#333')
        .attr('font-size', '11px');
    
    // X轴标签
    g.append('text')
        .attr('transform', `translate(${width / 2},${height + 45})`)
        .attr('text-anchor', 'middle')
        .attr('fill', '#333')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text('字符数');
    
    // 绘制Y轴
    const yAxis = d3.axisLeft(yScale)
        .ticks(yMax + 1)
        .tickFormat(d => Math.round(d));
    
    g.append('g')
        .attr('class', 'y-axis')
        .call(yAxis)
        .selectAll('text')
        .attr('fill', '#333')
        .attr('font-size', '11px');
    
    // Y轴标签
    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -45)
        .attr('x', -height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#333')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text('题目数');
    
    // 绘制网格线
    g.selectAll('.grid-line-x')
        .data(xScale.ticks(Math.min(10, filteredBins.length)))
        .enter()
        .append('line')
        .attr('class', 'grid-line-x')
        .attr('x1', d => xScale(d))
        .attr('x2', d => xScale(d))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', '#e0e0e0')
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '2,2');
    
    g.selectAll('.grid-line-y')
        .data(yScale.ticks(yMax + 1))
        .enter()
        .append('line')
        .attr('class', 'grid-line-y')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', d => yScale(d))
        .attr('y2', d => yScale(d))
        .attr('stroke', '#e0e0e0')
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '2,2');
    
    // 绘制堆叠柱状图（错误题目在底部，正确题目在上部）
    const barGroups = g.selectAll('.bar-group')
        .data(filteredBins)
        .enter()
        .append('g')
        .attr('class', 'bar-group')
        .style('cursor', 'pointer');
    
    // 绘制错误题目部分（底部，红色）
    barGroups.append('rect')
        .attr('class', 'bar-error')
        .attr('x', d => xScale(d.x0))
        .attr('width', d => xScale(d.x1) - xScale(d.x0) - 2) // 留出2px间隙
        .attr('y', d => yScale(d.errorCount))
        .attr('height', d => height - yScale(d.errorCount))
        .attr('fill', '#e74c3c')
        .attr('stroke', '#c0392b')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8);
    
    // 绘制正确题目部分（上部，蓝色）
    barGroups.append('rect')
        .attr('class', 'bar-correct')
        .attr('x', d => xScale(d.x0))
        .attr('width', d => xScale(d.x1) - xScale(d.x0) - 2)
        .attr('y', d => yScale(d.count))
        .attr('height', d => yScale(d.errorCount) - yScale(d.count))
        .attr('fill', '#3498db')
        .attr('stroke', '#2980b9')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8);
    
    // 添加鼠标悬停效果
    barGroups.on('mouseover', function(event, d) {
        // 高亮整个柱状图
        d3.select(this).select('.bar-error')
            .attr('opacity', 1);
        d3.select(this).select('.bar-correct')
            .attr('opacity', 1);
        
        // 显示提示信息
        const tooltip = d3.select('body').append('div')
            .attr('class', 'histogram-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(0, 0, 0, 0.8)')
            .style('color', '#fff')
            .style('padding', '8px 12px')
            .style('border-radius', '4px')
            .style('font-size', '12px')
            .style('pointer-events', 'none')
            .style('z-index', '1000')
            .html(`区间：${Math.round(d.x0)}-${Math.round(d.x1)}<br/>总数：${d.count}<br/>错误：${d.errorCount}<br/>合格：${d.correctCount}`);
        
        tooltip.style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', function() {
        d3.select(this).select('.bar-error')
            .attr('opacity', 0.8);
        d3.select(this).select('.bar-correct')
            .attr('opacity', 0.8);
        
        d3.selectAll('.histogram-tooltip').remove();
    });
    
    // 在柱状图顶部显示总数值标签（描边白色背景，避免与网格线/红色柱体重叠造成奇怪外观）
    const totalLabel = barGroups.append('text')
        .attr('class', 'bar-label-total')
        .attr('x', d => xScale(d.x0) + (xScale(d.x1) - xScale(d.x0)) / 2)
        .attr('y', d => Math.max(12, yScale(d.count) - 6))
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .style('paint-order', 'stroke')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('fill', '#333')
        .text(d => d.count > 0 ? d.count : '');
    
    // 在错误部分内部显示错误题目数量标签（仅当红色段足够高，且与总数不同时显示，避免与总数标签重复堆叠）
    barGroups.filter(d => d.errorCount > 0 && d.errorCount !== d.count)
        .append('text')
        .attr('class', 'bar-label-error')
        .attr('x', d => xScale(d.x0) + (xScale(d.x1) - xScale(d.x0)) / 2)
        .attr('y', d => {
            const errTop = yScale(d.errorCount);
            const errBottom = height;
            const errHeight = errBottom - errTop;
            // 红色段足够高（>=14px）则放在内部顶端，否则不显示
            return errHeight >= 14 ? errTop + 12 : -9999;
        })
        .attr('text-anchor', 'middle')
        .attr('fill', '#fff')
        .attr('font-size', '10px')
        .attr('font-weight', 'bold')
        .text(d => d.errorCount > 0 ? d.errorCount : '');
    
    // 添加图例（右上角）
    const legend = g.append('g')
        .attr('class', 'legend')
        .attr('transform', `translate(${width - 80}, -5)`);
    
    // 错误图例
    legend.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', 14)
        .attr('height', 14)
        .attr('fill', '#e74c3c')
        .attr('stroke', '#c0392b')
        .attr('stroke-width', 1)
        .attr('rx', 2);
    
    legend.append('text')
        .attr('x', 18)
        .attr('y', 11)
        .attr('fill', '#333')
        .attr('font-size', '11px')
        .text('错误');
    
    // Correct legend
    legend.append('rect')
        .attr('x', 50)
        .attr('y', 0)
        .attr('width', 14)
        .attr('height', 14)
        .attr('fill', '#3498db')
        .attr('stroke', '#2980b9')
        .attr('stroke-width', 1)
        .attr('rx', 2);
    
    legend.append('text')
        .attr('x', 68)
        .attr('y', 11)
        .attr('fill', '#333')
        .attr('font-size', '11px')
        .text('合格');
    
    console.log('形式规范直方图更新完成');
}

// 更新大题字符数堆叠瀑布图
function updateQuestionStackChart() {
    const svg = d3.select('#question-stack-svg');
    if (svg.empty()) return;
    
    // 清空SVG
    svg.selectAll('*').remove();
    
    // 使用从JSON文件加载的篇幅数据，如果没有则使用默认数据
    let lengthData = questionLengthData;
    
    // 如果没有加载到数据，使用默认数据（向后兼容）
    if (!lengthData || lengthData.length === 0) {
        lengthData = [
            {
                id: '一',
                name: '关系数据库分析题',
                description: 102,
                subQuestions: [26, 28, 22],
                total: 178
            },
            {
                id: '二',
                name: '关系代数运算及SQL语句',
                description: 248,
                subQuestions: [34, 38, 36, 36, 32, 34, 36, 54],
                total: 568
            },
            {
                id: '三',
                name: '应用题',
                description: 156,
                subQuestions: [148, 124, 142, 218, 184, 82, 46],
                total: 980
            },
            {
                id: '四',
                name: '数据库设计题',
                description: 236,
                subQuestions: [44, 74, 212, 94],
                total: 660
            }
        ];
        console.log('使用默认篇幅数据');
    } else {
        console.log('使用加载的篇幅数据:', lengthData.length, '条');
    }
    
    // 始终重新计算 total = description + sum(subQuestions)，避免数据中 total 遗漏 description 的情况
    lengthData = lengthData.map(item => ({
        ...item,
        total: (item.description || 0) + (item.subQuestions ? item.subQuestions.reduce((a, b) => a + b, 0) : 0)
    }));
    
    // 计算总字符数
    const totalChars = lengthData.reduce((sum, q) => sum + q.total, 0);
    
    // 构建瀑布图数据：第一列是总字符数，后面是各大题
    const waterfallData = [
        {
            id: '总计',
            name: '总字符数',
            description: 0,
            subQuestions: [],
            total: totalChars,
            isTotal: true
        },
        ...lengthData
    ];
    
    // 图表尺寸（再大1/4，底部预留图例空间，宽度增加）
    const margin = { top: 20, right: 20, bottom: 80, left: 50 }; // bottom从50增加到80，预留图例空间
    const width = 500 - margin.left - margin.right; // 从400增加到500，给图例更多空间
    const height = (500 * 1.0) - margin.top - margin.bottom; // 从0.8增加到1.0，再大1/4（0.8 * 1.25 = 1.0）
    
    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
    
    // 计算Y轴比例（基于总字符数）
    const yScale = d3.scaleLinear()
        .domain([0, totalChars * 1.1])
        .range([height, 0]);
    
    // X轴比例（5列：总计 + 4个大题）
    const xScale = d3.scaleBand()
        .domain(waterfallData.map(d => d.id))
        .range([0, width])
        .paddingInner(0.3)
        .paddingOuter(0.2);
    
    // 绘制Y轴
    const yAxis = d3.axisLeft(yScale)
        .ticks(6)
        .tickFormat(d => d);
    
    const yAxisGroup = g.append('g')
        .attr('class', 'y-axis')
        .call(yAxis);
    
    // Y轴标签
    yAxisGroup.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -40)
        .attr('x', -height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#333')
        .attr('font-size', '11px')
        .text('字符数');
    
    // 绘制X轴
    const xAxis = d3.axisBottom(xScale);
    
    g.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(xAxis)
        .selectAll('text')
        .attr('fill', '#333')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold');
    
    // 绘制坐标轴网格线（先绘制，在柱子后面）
    g.selectAll('.grid-line')
        .data(yScale.ticks(6))
        .enter()
        .append('line')
        .attr('class', 'grid-line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', d => yScale(d))
        .attr('y2', d => yScale(d))
        .attr('stroke', '#e0e0e0')
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '2,2');
    
    // 颜色方案 - 优化后的柔和配色
    const totalColor = '#546e7a'; // 蓝灰色 - 总字符数
    const descriptionColor = '#ffb74d'; // 柔和橙色 - 题目描述
    
    // 收集所有小题的字符数，用于计算颜色深浅
    const allSubQuestionChars = lengthData.flatMap(item => item.subQuestions || []);
    const minSubChars = Math.min(...allSubQuestionChars);
    const maxSubChars = Math.max(...allSubQuestionChars);
    
    // 创建基于字符数的颜色比例尺（字符越多颜色越深）
    // 使用青色系：从浅青色 #b2dfdb 到深青色 #00695c
    const subQuestionColorScale = d3.scaleLinear()
        .domain([minSubChars, maxSubChars])
        .range(['#b2dfdb', '#00695c'])  // 浅青色 → 深青色
        .clamp(true);
    
    // 计算每个柱子的起始Y位置（瀑布图效果）
    // 累计字符数，用于计算每个柱子的顶部位置
    let cumulativeChars = 0;
    
    // 绘制堆叠瀑布图
    waterfallData.forEach((item, i) => {
        const x = xScale(item.id);
        const barWidth = xScale.bandwidth();
        
        if (i === 0) {
            // 第一列：总字符数（从顶部到底部）
            // 顶部Y坐标：yScale(totalChars) = 0
            // 底部Y坐标：yScale(0) = height
            const barTopY = yScale(totalChars); // 顶部（SVG Y=0）
            const barBottomY = yScale(0); // 底部（SVG Y=height）
            const barHeight = barBottomY - barTopY;
            
            const totalRect = g.append('rect')
                .attr('x', x)
                .attr('y', barTopY)
                .attr('width', barWidth)
                .attr('height', barHeight)
                .attr('fill', totalColor)
                .attr('stroke', '#fff')
                .attr('stroke-width', 1)
                .attr('rx', 2)
                .attr('ry', 2);
            
            totalRect.append('title')
                .text(`总计：${item.total} 字符`);
            
            // 显示总字符数标签
            g.append('text')
                .attr('x', x + barWidth / 2)
                .attr('y', barTopY + 15)
                .attr('text-anchor', 'middle')
                .attr('fill', '#fff')
                .attr('font-size', '10px')
                .attr('font-weight', 'bold')
                .text(item.total);
            
            // 下一个柱子的顶部位置是总字符数的顶部（totalChars）
            cumulativeChars = totalChars;
        } else {
            // 后续列：从累计位置开始，向下堆叠
            // 当前柱子的顶部字符数位置（和上一列顶部对齐，第一列后是totalChars）
            const barTopChars = cumulativeChars;
            // 当前柱子的底部字符数位置
            const barBottomChars = cumulativeChars - item.total;
            
            // 转换为SVG坐标
            const barTopY = yScale(barTopChars); // 顶部Y坐标（SVG）
            const barBottomY = yScale(barBottomChars); // 底部Y坐标（SVG）
            const barHeight = barBottomY - barTopY;
            
            // 在柱子内部堆叠：从底部向上堆叠
            // 从柱子的底部开始堆叠
            let stackCurrentChars = barBottomChars; // 当前堆叠块的底部字符数位置
            
            // 绘制题目描述部分（最底部）
            const descHeight = (item.description / totalChars) * height;
            const descBottomY = yScale(stackCurrentChars);
            stackCurrentChars += item.description;
            const descTopY = yScale(stackCurrentChars);
            const descRect = g.append('rect')
                .attr('x', x)
                .attr('y', descTopY)
                .attr('width', barWidth)
                .attr('height', descBottomY - descTopY)
                .attr('fill', descriptionColor)
                .attr('stroke', '#fff')
                .attr('stroke-width', 1)
                .attr('rx', 2)
                .attr('ry', 2);
            
            descRect.append('title')
                .text(`题干：${item.description} 字符`);
            
            // 绘制各小题题干部分（堆叠在上方）
            // 颜色深浅表示字符数：字符越多颜色越深
            item.subQuestions.forEach((subChars, j) => {
                const subBottomY = yScale(stackCurrentChars);
                stackCurrentChars += subChars;
                const subTopY = yScale(stackCurrentChars);
                const subHeight = subBottomY - subTopY;
                const subColor = subQuestionColorScale(subChars); // 根据字符数计算颜色
                const subRect = g.append('rect')
                    .attr('x', x)
                    .attr('y', subTopY)
                    .attr('width', barWidth)
                    .attr('height', subHeight)
                    .attr('fill', subColor)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1)
                    .attr('rx', 2)
                    .attr('ry', 2);
                
                subRect.append('title')
                    .text(`第 ${j + 1} 小题：${subChars} 字符`);
            });
            
            // 在柱子顶部显示总字符数
            g.append('text')
                .attr('x', x + barWidth / 2)
                .attr('y', barTopY + 15)
                .attr('text-anchor', 'middle')
                .attr('fill', '#333')
                .attr('font-size', '10px')
                .attr('font-weight', 'bold')
                .text(item.total);
            
            // 下一个柱子的顶部位置是当前柱子的底部
            cumulativeChars = barBottomChars;
        }
    });
    
    // 生成总结性文字
    const statsDisplay = document.getElementById('format-stats-display');
    if (statsDisplay) {
        const totalQuestions = lengthData.length;
        const avgChars = Math.round(totalChars / totalQuestions);
        const maxQuestion = lengthData.reduce((max, q) => q.total > max.total ? q : max, lengthData[0]);
        const minQuestion = lengthData.reduce((min, q) => q.total < min.total ? q : min, lengthData[0]);
        
        // 统一样式的统计信息（紧凑版）
        let html = `
        <div style="display: flex; justify-content: space-between; gap: 4px; margin-bottom: 4px;">
            <div style="flex: 1; text-align: center; padding: 4px 2px; background: #fff; border-radius: 4px; border-bottom: 2px solid #546e7a;">
                <span style="color: #666; font-size: 9px; display: block;">总字符</span>
                <strong style="color: #333; font-size: 14px;">${totalChars}</strong>
                    </div>
            <div style="flex: 1; text-align: center; padding: 4px 2px; background: #fff; border-radius: 4px; border-bottom: 2px solid #78909c;">
                <span style="color: #666; font-size: 9px; display: block;">大题数</span>
                <strong style="color: #333; font-size: 14px;">${totalQuestions}</strong>
                    </div>
            <div style="flex: 1; text-align: center; padding: 4px 2px; background: #fff; border-radius: 4px; border-bottom: 2px solid #ffb74d;">
                <span style="color: #666; font-size: 9px; display: block;">最长(${maxQuestion.id})</span>
                <strong style="color: #ff8f00; font-size: 14px;">${maxQuestion.total}</strong>
                    </div>
            <div style="flex: 1; text-align: center; padding: 4px 2px; background: #fff; border-radius: 4px; border-bottom: 2px solid #26a69a;">
                <span style="color: #666; font-size: 9px; display: block;">最短(${minQuestion.id})</span>
                <strong style="color: #00897b; font-size: 14px;">${minQuestion.total}</strong>
                    </div>
                </div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 3px 6px; background: #fff; border-radius: 4px; font-size: 10px; color: #555;">
                <span style="font-weight: 600;">平均字符/题：</span>
            <strong style="color: #333; font-size: 13px;">${avgChars}</strong>
                <span>字符</span>
        </div>`;
        
        statsDisplay.innerHTML = html;
    }
    
    console.log('大题字符数堆叠瀑布图更新完成');
}

function getThresholdScore(value, thresholds = []) {
    // 按 min 从大到小，命中第一个
    const sorted = [...thresholds].sort((a, b) => b.min - a.min);
    const found = sorted.find(t => value >= t.min);
    return found ? found.score : 0;
}

// 计算大纲覆盖度分数（满分15分 = 章节覆盖率 5 + 重点达成率 5 + 知识点达成率 5），返回详细拆解
function calculateKnowledgeCoverageScore() {
    const totalChapters = chapterData.length;

    // 1) 章节覆盖率 C_ch = N_covered / N_total（5 分）
    const coveredChapters = chapterData.filter(ch => {
        const kps = chapterKnowledgeMap[ch.id] || [];
        return kps.length > 0;
    }).length;
    const chapterCoverageRate = totalChapters > 0 ? coveredChapters / totalChapters : 0;
    const chapterCoverageScore = getThresholdScore(
        chapterCoverageRate,
        radarRuleConfig.knowledge.chapterThresholds
    );

    // 2) 重点达成率 R_key —— 每章 min(1, A_i / K_i^key) 的算术平均（5 分）
    let metChapters = 0;
    let totalKeyPoints = 0;
    let metKeyPoints = 0;
    const _chapterRatios = [];
    const _kpRatios = [];

    chapterData.forEach(ch => {
        const kps = chapterKnowledgeMap[ch.id] || [];
        const actualCount = kps.length;
        const requiredCount = ch.keyPointsCount || 0;
        const totalKpInCh   = getChapterTotalKnowledgePoints(ch);
        totalKeyPoints += requiredCount;

        // R_key 的每章覆盖率
        const keyRatio = requiredCount > 0 ? Math.min(1, actualCount / requiredCount) : 1;
        _chapterRatios.push(keyRatio);

        // R_tot 的每章覆盖率（分母为总知识点）
        const totRatio = totalKpInCh > 0 ? Math.min(1, actualCount / totalKpInCh) : 1;
        _kpRatios.push(totRatio);

        // 辅助统计：达标章节数（重点阈值）
        if (actualCount >= requiredCount * chapterComplianceRatio) {
            metChapters++;
            metKeyPoints += Math.min(actualCount, requiredCount);
        } else {
            metKeyPoints += actualCount;
        }
    });

    const complianceRate = _chapterRatios.length > 0
        ? _chapterRatios.reduce((s, r) => s + r, 0) / _chapterRatios.length
        : 0;

    const keyPointsScore = getThresholdScore(
        complianceRate,
        radarRuleConfig.knowledge.complianceThresholds
    );

    // 3) 知识点达成率 R_tot —— 每章 min(1, A_i / K_i^tot) 的算术平均（5 分）
    const keypointHitRate = _kpRatios.length > 0
        ? _kpRatios.reduce((s, r) => s + r, 0) / _kpRatios.length
        : 0;
    const keypointScore = getThresholdScore(
        keypointHitRate,
        radarRuleConfig.knowledge.keypointThresholds
    );

    const totalScore = chapterCoverageScore + keyPointsScore + keypointScore;

    console.log('=== 大纲覆盖度评分 ===');
    console.log(`章节覆盖率:   ${(chapterCoverageRate * 100).toFixed(1)}%（${coveredChapters}/${totalChapters}） → ${chapterCoverageScore}/5`);
    console.log(`重点达成率:   ${(complianceRate    * 100).toFixed(1)}% → ${keyPointsScore}/5`);
    console.log(`知识点达成率: ${(keypointHitRate   * 100).toFixed(1)}% → ${keypointScore}/5`);
    console.log(`覆盖度总分:   ${totalScore}/15`);

    return {
        value: totalScore / 15,
        score15: totalScore,
        score10: totalScore, // 兼容旧字段名
        scoreMax: 15,
        chapterCoverageScore,
        keyPointsScore,
        keypointScore,
        chapterCoverageRate,
        complianceRate,
        keypointHitRate,
        coveredChapters,
        totalChapters,
        totalKeyPoints,
        metKeyPoints,
        metChapters,
        complianceRatio: chapterComplianceRatio,
        keypointComplianceRatio: knowledgePointComplianceRatio
    };
}

// 计算认知与题型多属性分析分数（满分10分），返回详细拆解
function calculateCognitiveTypeScore() {
    // 1. 知识类型（3分）：4种3分，3种2分，2种1分
    const coveredKnowledgeTypes = new Set();
    questionData.forEach(q => {
        if (q.knowledgeType) {
            coveredKnowledgeTypes.add(q.knowledgeType);
        }
    });
    const knowledgeTypeCount = coveredKnowledgeTypes.size;
    let knowledgeTypeScore = 0;
    for (const t of radarRuleConfig.cognitive.knowledgeTypeThresholds) {
        if (knowledgeTypeCount >= t.min) {
            knowledgeTypeScore = t.score;
            break;
        }
    }
    
    // 2. 布鲁姆目标（3分）：5-6种3分，3-4种2分，1-2种1分
    // 支持中文和英文布鲁姆层级
    const bloomLevelsCN = ['记忆', '理解', '应用', '分析', '评价', '创造'];
    const bloomLevelsEN = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
    const bloomLevels = [...bloomLevelsCN, ...bloomLevelsEN];
    
    // 英文到中文的映射，用于统一计数
    const bloomEN2CN = {
        'Remember': '记忆', 'Understand': '理解', 'Apply': '应用',
        'Analyze': '分析', 'Evaluate': '评价', 'Create': '创造'
    };
    
    const coveredBloomLevels = new Set();
    questionData.forEach(q => {
        if (q.bloomGoal) {
            // 统一转换为英文进行统计
            const normalizedBloom = bloomEN2CN[q.bloomGoal] ? q.bloomGoal : 
                Object.keys(bloomEN2CN).find(en => bloomEN2CN[en] === q.bloomGoal) || q.bloomGoal;
            if (bloomLevels.includes(q.bloomGoal)) {
                coveredBloomLevels.add(normalizedBloom);
            }
        }
    });
    const bloomCoverageCount = coveredBloomLevels.size;
    let bloomScore = 0;
    for (const t of radarRuleConfig.cognitive.bloomThresholds) {
        if (bloomCoverageCount >= t.min) {
            bloomScore = t.score;
            break;
        }
    }
    
    // 3. 题型（3分）：5-6种3分，3-4种2分，1-2种1分（直接数不同题型数量）
    const coveredTypes = new Set();
    questionData.forEach(q => {
        if (q.questionType) {
            coveredTypes.add(q.questionType);
        }
    });
    const typeCoverageCount = coveredTypes.size;
    let typeScore = 0;
    for (const t of radarRuleConfig.cognitive.typeThresholds) {
        if (typeCoverageCount >= t.min) {
            typeScore = t.score;
            break;
        }
    }
    
    // 4. 难度等级（1分）：中等难度占比>60%得1分
    // 支持中文和英文难度标签
    let mediumCount = 0;
    let totalQuestions = questionData.length;
    questionData.forEach(q => {
        if (q.difficulty === '中' || q.difficulty === 'Medium') {
            mediumCount++;
        }
    });
    const mediumRatio = totalQuestions > 0 ? mediumCount / totalQuestions : 0;
    const difficultyThreshold = radarRuleConfig.cognitive.difficultyThreshold || 0.6;
    const difficultyScore = mediumRatio > difficultyThreshold ? 1 : 0;
    
    const totalScore = knowledgeTypeScore + bloomScore + typeScore + difficultyScore;
    
    console.log('=== 认知与题型多属性分析分数计算 ===');
    console.log(`知识类型: ${Array.from(coveredKnowledgeTypes).join(', ')}（${knowledgeTypeCount}种）得分: ${knowledgeTypeScore}/3`);
    console.log(`布鲁姆层级: ${Array.from(coveredBloomLevels).join(', ')}（${bloomCoverageCount}种）得分: ${bloomScore}/3`);
    console.log(`题型: ${Array.from(coveredTypes).join(', ')}（${typeCoverageCount}种）得分: ${typeScore}/3`);
    console.log(`中等难度占比: ${(mediumRatio * 100).toFixed(1)}%（${mediumCount}/${totalQuestions}）得分: ${difficultyScore}/1`);
    console.log(`认知与题型多属性分析总分: ${totalScore}/10`);
    
    return {
        value: totalScore / 10, // 0-1
        score10: totalScore,
        knowledgeTypeScore,
        bloomScore,
        typeScore,
        difficultyScore,
        knowledgeTypeCount,
        coveredKnowledgeTypes: Array.from(coveredKnowledgeTypes),
        bloomCoverageCount,
        coveredBloomLevels: Array.from(coveredBloomLevels),
        typeCoverageCount,
        coveredTypes: Array.from(coveredTypes),
        mediumCount,
        totalQuestions,
        mediumRatio
    };
}

// 计算形式规范与篇幅分数（满分10分），返回详细拆解
function calculateFormatScore() {
    // 1. 篇幅合规率（5分）
    // 支持中文和英文题型
    const typeCharRanges = {
        // 中文题型
        '填空': { min: 30, max: 100 },
        '简答': { min: 50, max: 150 },
        '计算': { min: 80, max: 200 },
        '论述': { min: 100, max: 300 },
        '案例分析': { min: 300, max: 800 },
        // 英文题型
        'MCQ': { min: 30, max: 150 },           // 选择题
        'Blank': { min: 30, max: 100 },          // 填空题
        'Solution': { min: 80, max: 300 },       // 解答题
        'Essay': { min: 100, max: 400 },         // 论述题
        'Case': { min: 200, max: 600 },          // 案例分析
        'Short Answer': { min: 50, max: 150 },   // 简答题
        'Calculation': { min: 80, max: 200 }     // 计算题
    };
    
    let compliantCount = 0;
    let totalCount = 0;
    
    questionData.forEach(q => {
        const questionId = q.questionId;
        const questionInfo = questionContentMap[questionId];
        if (questionInfo) {
            const content = questionInfo.content || '';
            const charCount = content.length;
            const questionType = q.questionType;
            const range = typeCharRanges[questionType];
            
            if (range) {
                totalCount++;
                if (charCount >= range.min && charCount <= range.max) {
                    compliantCount++;
                }
            }
        }
    });
    
    const complianceRate = totalCount > 0 ? compliantCount / totalCount : 0;
    
    // 使用可调规则计算分数
    let lengthScore = 0;
    for (const t of radarRuleConfig.format.lengthThresholds) {
        if (complianceRate >= t.min) {
            lengthScore = t.score;
            break;
        }
    }
    
    // 2. 规范表述准确率（5分）- 根据错误数量计算
    const totalQuestions = Object.keys(questionContentMap).length;
    const totalErrors = formatImprovementData.length;
    const errorRate = totalQuestions > 0 ? totalErrors / totalQuestions : 0;
    const accuracyRate = 1 - errorRate;
    
    // 使用可调规则计算分数
    let accuracyScore = 0;
    for (const t of radarRuleConfig.format.accuracyThresholds) {
        if (accuracyRate >= t.min) {
            accuracyScore = t.score;
            break;
        }
    }
    
    const totalScore = lengthScore + accuracyScore;
    
    console.log('=== 形式规范与篇幅分数计算 ===');
    console.log(`总题目数: ${totalCount}`);
    console.log(`篇幅合规题目数: ${compliantCount}`);
    console.log(`篇幅合规率: ${(complianceRate * 100).toFixed(2)}%`);
    console.log(`篇幅合规率得分: ${lengthScore}/5`);
    console.log(`总题目数: ${totalQuestions}`);
    console.log(`错误题目数: ${totalErrors}`);
    console.log(`错误率: ${(errorRate * 100).toFixed(2)}%`);
    console.log(`规范表述准确率: ${(accuracyRate * 100).toFixed(2)}%`);
    console.log(`规范表述准确率得分: ${accuracyScore}/5`);
    console.log(`形式规范与篇幅总分: ${totalScore}/10`);
    
    return {
        value: totalScore / 10, // 0-1
        score10: totalScore,
        lengthScore,
        accuracyScore,
        complianceRate,
        totalCount,
        compliantCount,
        accuracyRate,
        totalErrors,
        totalQuestions
    };
}

// 取当前维度的展示值（自动 / 自定义）
function getRadarValueForDimension(key, computedValue) {
    const customVal = radarCustomValues[key];
    if (radarValueMode === 'custom' && customVal !== null && !isNaN(customVal)) {
        // 将自定义值限制在0-1之间
        return Math.max(0, Math.min(1, customVal));
    }
    return computedValue;
}

// 同步右侧输入控件与当前值
function syncRadarInputsWithValues(results = {}) {
    const dims = ['knowledge', 'cognitive', 'format'];
    dims.forEach(key => {
        const base = (radarValueMode === 'custom' && radarCustomValues[key] !== null)
            ? radarCustomValues[key]
            : results?.[key]?.value ?? 0;
        const display = Number((base * 10).toFixed(1));
        const range = document.querySelector(`.radar-range[data-dim="${key}"]`);
        const number = document.querySelector(`.radar-number[data-dim="${key}"]`);
        if (range) range.value = display;
        if (number) number.value = display;
    });
    
    const modeRadios = document.querySelectorAll('input[name="radar-value-mode"]');
    modeRadios.forEach(r => {
        r.checked = r.value === radarValueMode;
    });
}

// 更新计算公式与分值展示（渲染到各个区域的总结卡片）
function updateRadarFormulaPanel(results = {}) {
    const rows = [
        {
            key: 'knowledge',
            title: '大纲覆盖度',
            res: results.knowledge,
            formula: (r) => {
                const view = (typeof currentCoverageView === 'string') ? currentCoverageView : 'chapter-rate';
                const rows = [
                    { id: 'chapter-rate',    label: '章节覆盖率',   color: '#1565c0', score: r.chapterCoverageScore ?? 0, rate: (r.chapterCoverageRate ?? 0) * 100 },
                    { id: 'compliance-rate', label: '重点达成率',   color: '#ff9800', score: r.keyPointsScore        ?? 0, rate: (r.complianceRate       ?? 0) * 100 },
                    { id: 'keypoint-rate',   label: '知识点达成率', color: '#9c27b0', score: r.keypointScore         ?? 0, rate: (r.keypointHitRate      ?? 0) * 100 }
                ];
                const items = rows.map(row => {
                    const active = view === row.id;
                    const bg = active ? `background: ${row.color}1A; border-left: 3px solid ${row.color}; padding-left: 5px;` : '';
                    const w  = active ? 'font-weight: 700;' : '';
                    return `<div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; border-radius: 3px; ${bg} ${w}">
                        <span style="color: ${row.color};">${row.label}</span>
                        <span><strong>${row.score}/5</strong>　<span style="color:#888; font-size: 9.5px;">(${row.rate.toFixed(1)}%)</span></span>
                    </div>`;
                }).join('');
                return `${items}
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 4px; margin-top: 3px; border-top: 1px dashed #ccc;">
                        <span style="color:#333;">合计</span>
                        <strong style="color:#1565c0;">${r.score15 ?? 0}/15</strong>
                    </div>`;
            },
            meta: (r) => {
                const view = (typeof currentCoverageView === 'string') ? currentCoverageView : 'chapter-rate';
                if (view === 'chapter-rate') {
                    const rate = (r.chapterCoverageRate ?? 0) * 100;
                    return `已覆盖 <strong>${r.coveredChapters ?? 0}/${r.totalChapters ?? 0}</strong> | 章节覆盖率 <strong style="color:${rate >= 60 ? '#4caf50' : '#ff9800'}">${rate.toFixed(1)}%</strong>`;
                } else if (view === 'keypoint-rate') {
                    const rate = (r.keypointHitRate ?? 0) * 100;
                    const tauPct = ((r.keypointComplianceRatio ?? 0.4) * 100).toFixed(0);
                    return `阈值 τ = <strong>${tauPct}%</strong> | 知识点达成率 <strong style="color:${rate >= 50 ? '#4caf50' : '#ff9800'}">${rate.toFixed(1)}%</strong>（每章覆盖率均值）`;
                } else {
                    const rate = (r.complianceRate ?? 0) * 100;
                    const tauPct = ((r.complianceRatio ?? 0.4) * 100).toFixed(0);
                    return `阈值 τ = <strong>${tauPct}%</strong> | 达标章节 <strong>${r.metChapters ?? 0}/${r.totalChapters ?? 0}</strong> | 重点达成率 <strong style="color:${rate >= 60 ? '#4caf50' : '#ff9800'}">${rate.toFixed(1)}%</strong>（每章覆盖率均值）`;
                }
            }
        },
        {
            key: 'cognitive',
            title: '认知分析',
            res: results.cognitive,
            formula: (r) => `<span style="color:#9c27b0">知识类型</span> ${r.knowledgeTypeScore ?? 0}/3 + <span style="color:#1565c0">Bloom</span> ${r.bloomScore ?? 0}/3 + <span style="color:#ff9800">题型</span> ${r.typeScore ?? 0}/3 + <span style="color:#4caf50">难度</span> ${r.difficultyScore ?? 0}/1 = <strong>${r.score10 ?? 0}/10</strong>`,
            meta: (r, used) => {
                const mediumPercent = ((r.mediumRatio ?? 0) * 100).toFixed(1);
                return `知识类型 <strong>${r.knowledgeTypeCount ?? 0}</strong> | Bloom <strong>${r.bloomCoverageCount ?? 0}/6</strong> | 题型 <strong>${r.typeCoverageCount ?? 0}</strong> | 中等难度占比 <strong style="color:${parseFloat(mediumPercent) > 60 ? '#4caf50' : '#ff9800'}">${mediumPercent}%</strong>`;
            }
        },
        {
            key: 'format',
            title: '形式与篇幅',
            res: results.format,
            formula: (r) => `<span style="color:#1565c0">篇幅合规</span> ${r.lengthScore ?? 0}/5 + <span style="color:#ff9800">表述准确</span> ${r.accuracyScore ?? 0}/5 = <strong>${r.score10 ?? 0}/10</strong>`,
            meta: (r, used) => {
                const complianceRate = (r.complianceRate ?? 0) * 100;
                const accuracyRate = (r.accuracyRate ?? 0) * 100;
                return `篇幅 <strong style="color:${complianceRate >= 60 ? '#4caf50' : '#ff9800'}">${complianceRate.toFixed(1)}%</strong>（${r.compliantCount ?? 0}/${r.totalCount || 0}） | 准确率 <strong style="color:${accuracyRate >= 60 ? '#4caf50' : '#ff9800'}">${accuracyRate.toFixed(1)}%</strong>（错误 ${r.totalErrors ?? 0}/${r.totalQuestions || 0}）`;
            }
        }
    ];
    
    // 渲染到对应区域的总结卡片
    renderFormulaSummaryToPanel(rows[0], 'knowledge-formula-summary');
    renderFormulaSummaryToPanel(rows[1], 'cognitive-formula-summary');
    renderFormulaSummaryToPanel(rows[2], 'format-formula-summary');
}

function renderFormulaSummaryToPanel(row, targetId) {
    const el = document.getElementById(targetId);
    if (!el || !row || !row.res) return;
    const used = getRadarValueForDimension(row.key, row.res.value || 0);
    // 知识覆盖（覆盖度）改为 /15 显示；其他维度保持 /10
    const isCoverage = row.key === 'knowledge';
    const totalScore = isCoverage ? (row.res.score15 ?? 0) : (row.res.score10 ?? 0);
    const totalMax = isCoverage ? 15 : 10;
    el.innerHTML = `
        <div style="background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%); border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; margin-top: 4px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-size: 12px; font-weight: 700; color: #333;">${row.title}</span>
                <span style="font-size: 11px; background: #1565c0; color: #fff; padding: 2px 8px; border-radius: 10px; font-weight: 600;">${totalScore}/${totalMax}</span>
            </div>
            <div style="font-size: 10px; color: #444; line-height: 1.4; margin-bottom: 4px; padding: 4px 6px; background: #fff; border-radius: 4px;">${row.formula(row.res)}</div>
            <div style="font-size: 9px; color: #555; line-height: 1.4; border-top: 1px dashed #ccc; padding-top: 4px;">${row.meta(row.res, used)}</div>
        </div>
    `;
}

// 处理滑杆 / 数字输入
function handleRadarInputChange(event) {
    const dim = event.target.getAttribute('data-dim');
    if (!dim) return;
    const raw = parseFloat(event.target.value);
    const clamped10 = Math.max(0, Math.min(10, isNaN(raw) ? 0 : raw));
    const normalized = clamped10 / 10;
    
    radarValueMode = 'custom';
    radarCustomValues[dim] = normalized;
    
    // 同步另一输入
    const pairSelector = event.target.classList.contains('radar-range')
        ? `.radar-number[data-dim="${dim}"]`
        : `.radar-range[data-dim="${dim}"]`;
    const pair = document.querySelector(pairSelector);
    if (pair) pair.value = clamped10;
    
    // 切换单选按钮
    const customRadio = document.querySelector('input[name="radar-value-mode"][value="custom"]');
    if (customRadio) customRadio.checked = true;
    
    updateRadarChart();
}

function resetRadarCustomValues() {
    radarValueMode = 'auto';
    radarCustomValues = { knowledge: null, cognitive: null, format: null };
    const autoRadio = document.querySelector('input[name="radar-value-mode"][value="auto"]');
    if (autoRadio) autoRadio.checked = true;
    updateRadarChart();
}

// 当前选中的分段（用于编辑）
let selectedSegment = { barId: null, idx: null };

// 生成分段条HTML
function renderSegmentBar(barId, thresholds, maxVal, unit, isPercent = false) {
    // thresholds: [{min, score}, ...] 从高到低排列，最后一个是0分
    const segments = thresholds.slice(0, -1); // 去掉0分那个
    // 反转顺序，让分数从左到右：1分、2分、3分、4分、5分
    const reversedSegments = [...segments].reverse();
    let html = `<div class="segment-bar" data-bar="${barId}">`;
    reversedSegments.forEach((t) => {
        // 找到原始索引
        const originalIdx = segments.findIndex(s => s.score === t.score);
        const displayVal = isPercent ? (t.min * 100).toFixed(0) + '%' : t.min + unit;
        const isSelected = selectedSegment.barId === barId && selectedSegment.idx === originalIdx;
        html += `<div class="segment" data-bar="${barId}" data-idx="${originalIdx}" ${isSelected ? 'data-selected="true"' : ''}>
            <div class="segment-score">${t.score} 分</div>
            <div class="segment-val">≥${displayVal}</div>
        </div>`;
    });
    html += `</div>`;
    // 滑杆（仅当有选中时显示）
    if (selectedSegment.barId === barId && selectedSegment.idx !== null) {
        const t = thresholds[selectedSegment.idx];
        const curVal = isPercent ? (t.min * 100).toFixed(0) : t.min;
        html += `<div class="segment-slider-row">
            <span class="segment-slider-label">${t.score} 分：</span>
            <input type="range" min="0" max="${isPercent ? 100 : maxVal}" step="1" class="segment-slider" data-bar="${barId}" data-idx="${selectedSegment.idx}" value="${curVal}">
            <span class="segment-slider-val">${curVal}${isPercent ? '%' : unit}</span>
        </div>`;
    }
    return html;
}

// 渲染评分规则表单（分段矩形条）
function renderRadarRuleForm() {
    const titleEl = document.getElementById('radar-rule-title');
    const contentEl = document.getElementById('radar-rule-content');
    if (!contentEl) return;
    
    let html = '';
    
    if (currentRuleMetric === 'knowledge') {
        // 按左侧三个按钮 (currentCoverageView) 切换评分规则
        const view = (typeof currentCoverageView === 'string') ? currentCoverageView : 'chapter-rate';
        const viewMap = {
            'chapter-rate':    { title: '章节覆盖率（5 分）',   bar: 'chapter',    thresholds: radarRuleConfig.knowledge.chapterThresholds,    isPercent: true },
            'compliance-rate': { title: '重点达成率（5 分）',   bar: 'compliance', thresholds: radarRuleConfig.knowledge.complianceThresholds, isPercent: true },
            'keypoint-rate':   { title: '知识点达成率（5 分）', bar: 'keypoint',   thresholds: radarRuleConfig.knowledge.keypointThresholds,   isPercent: true }
        };
        const cfg = viewMap[view] || viewMap['chapter-rate'];
        if (titleEl) titleEl.textContent = '大纲覆盖度评分规则';
        html += `<div class="segment-group"><div class="segment-group-title">${cfg.title}</div>`;
        html += renderSegmentBar(cfg.bar, cfg.thresholds, 100, '', cfg.isPercent);
        html += `</div>`;
    } else if (currentRuleMetric === 'cognitive') {
        if (titleEl) titleEl.textContent = '认知分析评分规则';
        html += `<div class="segment-group"><div class="segment-group-title">知识类型（3 分）</div>`;
        html += renderSegmentBar('knowledgeType', radarRuleConfig.cognitive.knowledgeTypeThresholds, 4, '', false);
        html += `</div>`;
        html += `<div class="segment-group"><div class="segment-group-title">Bloom 层级（3 分）</div>`;
        html += renderSegmentBar('bloom', radarRuleConfig.cognitive.bloomThresholds, 6, '', false);
        html += `</div>`;
        html += `<div class="segment-group"><div class="segment-group-title">题型分布（3 分）</div>`;
        html += renderSegmentBar('qtype', radarRuleConfig.cognitive.typeThresholds, 6, '', false);
        html += `</div>`;
        // Difficulty threshold (1pt)
        const diffThreshold = (radarRuleConfig.cognitive.difficultyThreshold || 0.6) * 100;
        html += `<div class="segment-group"><div class="segment-group-title">难度（1 分）：中等占比</div>`;
        html += `<div class="difficulty-slider-row">
            <span class="segment-slider-label">≥</span>
            <input type="range" min="0" max="100" step="1" class="segment-slider" data-bar="difficulty" value="${diffThreshold}">
            <span class="segment-slider-val" id="difficulty-val">${diffThreshold.toFixed(0)}%</span>
            <span style="font-size: 9px; color: #666;">= 1 分</span>
        </div>`;
        html += `</div>`;
    } else if (currentRuleMetric === 'format') {
        if (titleEl) titleEl.textContent = '形式与篇幅评分规则';
        html += `<div class="segment-group"><div class="segment-group-title">篇幅合规（5 分）</div>`;
        html += renderSegmentBar('length', radarRuleConfig.format.lengthThresholds, 100, '', true);
        html += `</div>`;
        html += `<div class="segment-group"><div class="segment-group-title">表述准确（5 分）</div>`;
        html += renderSegmentBar('accuracy', radarRuleConfig.format.accuracyThresholds, 100, '', true);
        html += `</div>`;
    }
    
    contentEl.innerHTML = html;
    
    // 绑定分段点击事件
    contentEl.querySelectorAll('.segment').forEach(seg => {
        seg.addEventListener('click', function() {
            const barId = this.getAttribute('data-bar');
            const idx = parseInt(this.getAttribute('data-idx'), 10);
            if (selectedSegment.barId === barId && selectedSegment.idx === idx) {
                // 取消选中
                selectedSegment = { barId: null, idx: null };
            } else {
                selectedSegment = { barId, idx };
            }
            renderRadarRuleForm();
        });
    });
    
    // 绑定滑杆事件
    contentEl.querySelectorAll('.segment-slider').forEach(slider => {
        slider.addEventListener('input', function() {
            const barId = this.getAttribute('data-bar');
            const idxAttr = this.getAttribute('data-idx');
            const idx = idxAttr !== null ? parseInt(idxAttr, 10) : null;
            const val = parseFloat(this.value);
            updateThresholdValue(barId, idx, val);
            // 更新显示值
            const valSpan = this.nextElementSibling;
            if (valSpan) {
                const isPercent = ['chapter', 'compliance', 'keypoint', 'length', 'accuracy', 'difficulty'].includes(barId);
                if (barId === 'difficulty') {
                    valSpan.textContent = val.toFixed(0) + '%';
                } else {
                    valSpan.textContent = val + (isPercent ? '%' : '');
                }
            }
            // 更新分段条显示（仅针对有idx的分段条）
            if (idx !== null) {
                const segmentEl = contentEl.querySelector(`.segment[data-bar="${barId}"][data-idx="${idx}"] .segment-val`);
                if (segmentEl) {
                    const isPercent = ['chapter', 'compliance', 'keypoint', 'length', 'accuracy'].includes(barId);
                    segmentEl.textContent = '≥' + val + (isPercent ? '%' : '');
                }
            }
        });
    });
}

// 更新阈值
function updateThresholdValue(barId, idx, val) {
    if (barId === 'chapter') {
        radarRuleConfig.knowledge.chapterThresholds[idx].min = Math.max(0, Math.min(100, val)) / 100;
    } else if (barId === 'compliance') {
        radarRuleConfig.knowledge.complianceThresholds[idx].min = Math.max(0, Math.min(100, val)) / 100;
    } else if (barId === 'keypoint') {
        radarRuleConfig.knowledge.keypointThresholds[idx].min = Math.max(0, Math.min(100, val)) / 100;
    } else if (barId === 'knowledgeType') {
        radarRuleConfig.cognitive.knowledgeTypeThresholds[idx].min = Math.max(0, Math.min(4, val));
    } else if (barId === 'bloom') {
        radarRuleConfig.cognitive.bloomThresholds[idx].min = Math.max(0, Math.min(6, val));
    } else if (barId === 'qtype') {
        radarRuleConfig.cognitive.typeThresholds[idx].min = Math.max(0, Math.min(6, val));
    } else if (barId === 'difficulty') {
        radarRuleConfig.cognitive.difficultyThreshold = Math.max(0, Math.min(100, val)) / 100;
    } else if (barId === 'length') {
        radarRuleConfig.format.lengthThresholds[idx].min = Math.max(0, Math.min(100, val)) / 100;
    } else if (barId === 'accuracy') {
        radarRuleConfig.format.accuracyThresholds[idx].min = Math.max(0, Math.min(100, val)) / 100;
    }
}

// 应用规则更新雷达图
function applyRadarRuleForm() {
    // 阈值已在滑杆拖动时实时更新，这里只需更新雷达图
    updateRadarChart();
}

function resetRadarRulesToDefault() {
    radarRuleConfig = JSON.parse(JSON.stringify(defaultRadarRuleConfig));
    selectedSegment = { barId: null, idx: null }; // 重置选中状态
    renderRadarRuleForm();
    updateRadarChart();
}

// 初始化雷达分值调节控件
function setupRadarControls() {
    const modeRadios = document.querySelectorAll('input[name="radar-value-mode"]');
    modeRadios.forEach(r => {
        r.addEventListener('change', (e) => {
            radarValueMode = e.target.value;
            if (radarValueMode === 'auto') {
                radarCustomValues = { knowledge: null, cognitive: null, format: null };
            }
            updateRadarChart();
        });
    });
    
    const adjustInputs = document.querySelectorAll('.radar-range, .radar-number');
    adjustInputs.forEach(input => {
        input.addEventListener('input', handleRadarInputChange);
    });
    
    const resetBtn = document.getElementById('radar-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetRadarCustomValues);
    }
    
    // 评分规则
    renderRadarRuleForm();
    const applyRuleBtn = document.getElementById('radar-apply-rule-btn');
    if (applyRuleBtn) {
        applyRuleBtn.addEventListener('click', applyRadarRuleForm);
    }
    const resetRuleBtn = document.getElementById('radar-reset-rule-btn');
    if (resetRuleBtn) {
        resetRuleBtn.addEventListener('click', resetRadarRulesToDefault);
    }
}

// 更新雷达图
function updateRadarChart() {
    if (!analysisData && !dataLoaded) return;
    
    // 检查D3.js是否已加载（虽然雷达图主要使用原生SVG，但为了一致性检查）
    const svgElement = document.getElementById('radar-svg');
    if (!svgElement) {
        console.error('找不到雷达图容器');
        return;
    }
    
    // 清除现有内容
    while (svgElement.firstChild) {
        svgElement.removeChild(svgElement.firstChild);
    }
    
    // 添加SVG滤镜（用于美化效果）
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'glow');
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');
    
    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feGaussianBlur.setAttribute('stdDeviation', '2');
    feGaussianBlur.setAttribute('result', 'coloredBlur');
    filter.appendChild(feGaussianBlur);
    
    const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const feMergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    feMergeNode1.setAttribute('in', 'coloredBlur');
    const feMergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    feMergeNode2.setAttribute('in', 'SourceGraphic');
    feMerge.appendChild(feMergeNode1);
    feMerge.appendChild(feMergeNode2);
    filter.appendChild(feMerge);
    
    defs.appendChild(filter);
    svgElement.appendChild(defs);
    
    // SVG viewBox是-40 -50 280 300，让雷达图更大
    // 中心点在(100, 100)
    const viewBoxWidth = 260;
    const viewBoxHeight = 280;
    const viewBoxOffset = 30; // viewBox的偏移量
    const radius = 100; // 增大半径
    const centerX = 100; // 在viewBox坐标系中的中心点
    const centerY = 100;
    
    // 根据新规范计算三个维度的分数（满分10分，转换为0-1之间的值）
    const knowledgeCoverage = calculateKnowledgeCoverageScore();
    const cognitiveType = calculateCognitiveTypeScore();
    const formatScore = calculateFormatScore();
    
    lastRadarComputed = {
        knowledge: knowledgeCoverage,
        cognitive: cognitiveType,
        format: formatScore
    };
    
    // 分析各维度缺陷
    dimensionDefects.knowledge = analyzeKnowledgeDefects(knowledgeCoverage);
    dimensionDefects.cognitive = analyzeCognitiveDefects(cognitiveType);
    dimensionDefects.format = analyzeFormatDefects(formatScore);
    
    // 更新缺陷显示
    updateDefectsDisplay();
    
    // ============ 雷达图三个维度全部改为「大纲覆盖度」相关指标 ============
    // 1) 章节覆盖率   = 已覆盖章节数 / 总章节数
    // 2) 重点达成率   = avg over chapters of min(1, 实际/重点)
    // 3) 知识点达成率 = avg over chapters of min(1, 实际/总知识点)
    const kc = knowledgeCoverage || {};
    const chapterCoverageRate = (kc.totalChapters > 0)
        ? (kc.coveredChapters || 0) / kc.totalChapters
        : 0;

    const rawActualsR    = (chapterData || []).map(ch => (chapterKnowledgeMap[ch.id] || []).length);
    const rawRequiredR   = (chapterData || []).map(ch => ch.keyPointsCount || 0);
    const rawTotalKPR    = (chapterData || []).map(ch => getChapterTotalKnowledgePoints(ch));
    const totalChaptersR = chapterData?.length || 0;

    // 重点达成率：每章 min(1, 实际/重点) 的平均
    const complianceRatios = rawActualsR.map((a, i) => {
        const req = rawRequiredR[i];
        if (req <= 0) return 1;
        return Math.min(1, a / req);
    });
    const complianceRate = complianceRatios.length > 0
        ? complianceRatios.reduce((s, r) => s + r, 0) / complianceRatios.length
        : 0;

    // 知识点达成率：每章 min(1, 实际/总知识点) 的平均
    const kpRatios = rawActualsR.map((a, i) => {
        const tot = rawTotalKPR[i];
        if (tot <= 0) return 1;
        return Math.min(1, a / tot);
    });
    const keyPointHitRate = kpRatios.length > 0
        ? kpRatios.reduce((s, r) => s + r, 0) / kpRatios.length
        : 0;

    console.log('=== 大纲覆盖雷达图三个维度 ===');
    console.log(`章节覆盖率:   ${(chapterCoverageRate * 100).toFixed(1)}% (${kc.coveredChapters || 0}/${kc.totalChapters || 0})`);
    console.log(`重点达成率:   ${(complianceRate * 100).toFixed(1)}% (avg over ${totalChaptersR} chapters)`);
    console.log(`知识点达成率: ${(keyPointHitRate * 100).toFixed(1)}% (avg over ${totalChaptersR} chapters)`);

    const dimensions = [
        { name: '章节覆盖率',   key: 'chapterRate',    value: chapterCoverageRate },
        { name: '重点达成率',   key: 'complianceRate', value: complianceRate },
        { name: '知识点达成率', key: 'keyPointRate',   value: keyPointHitRate }
    ];
    
    const angleStep = (2 * Math.PI) / dimensions.length;
    
    // 绘制网格（美化：使用更柔和的颜色和渐变效果）
    for (let i = 1; i <= 5; i++) {
        const r = (radius / 5) * i;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', centerX);
        circle.setAttribute('cy', centerY);
        circle.setAttribute('r', r);
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', i === 5 ? '#e0e0e0' : '#f0f0f0'); // 最外层用稍深的颜色
        circle.setAttribute('stroke-width', i === 5 ? 1.5 : 1);
        circle.setAttribute('opacity', 0.8);
        svgElement.appendChild(circle);
    }
    
    // 绘制轴线
    dimensions.forEach((dim, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', centerX);
        line.setAttribute('y1', centerY);
        line.setAttribute('x2', x);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', '#e0e0e0');
        line.setAttribute('stroke-width', 1.2);
        line.setAttribute('opacity', 0.6);
        svgElement.appendChild(line);
        
        // 标签（简洁名称，横排显示）
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const labelOffset = 15; // 标签距离轴线的距离
        const labelX = x + (x - centerX) / radius * labelOffset;
        const labelY = y + (y - centerY) / radius * labelOffset;
        text.setAttribute('x', labelX);
        text.setAttribute('y', labelY);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '12');
        text.setAttribute('fill', '#333');
        text.setAttribute('font-weight', '600');
        text.textContent = dim.name;
        svgElement.appendChild(text);
    });
    
    // 绘制及格线（60分，即0.6）- 用三角形表示，在数据多边形之前绘制
    const passRadius = radius * 0.6;
    const passPoints = dimensions.map((dim, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const x = centerX + passRadius * Math.cos(angle);
        const y = centerY + passRadius * Math.sin(angle);
        return `${x},${y}`;
    }).join(' ');
    
    const passPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    passPolygon.setAttribute('points', passPoints);
    passPolygon.setAttribute('fill', 'none');
    passPolygon.setAttribute('stroke', '#ff9800');
    passPolygon.setAttribute('stroke-width', 2);
    passPolygon.setAttribute('stroke-dasharray', '5,5');
    passPolygon.setAttribute('opacity', 0.7);
    svgElement.appendChild(passPolygon);
    
    // 绘制优秀线（80分，即0.8）- 用三角形表示，在数据多边形之前绘制
    const excellentRadius = radius * 0.8;
    const excellentPoints = dimensions.map((dim, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const x = centerX + excellentRadius * Math.cos(angle);
        const y = centerY + excellentRadius * Math.sin(angle);
        return `${x},${y}`;
    }).join(' ');
    
    const excellentPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    excellentPolygon.setAttribute('points', excellentPoints);
    excellentPolygon.setAttribute('fill', 'none');
    excellentPolygon.setAttribute('stroke', '#4caf50');
    excellentPolygon.setAttribute('stroke-width', 2);
    excellentPolygon.setAttribute('stroke-dasharray', '5,5');
    excellentPolygon.setAttribute('opacity', 0.7);
    svgElement.appendChild(excellentPolygon);
    
    // 绘制数据多边形（最后绘制，显示在最上层）- 美化
    const points = dimensions.map((dim, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const r = radius * dim.value;
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);
        return `${x},${y}`;
    }).join(' ');
    
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', points);
    polygon.setAttribute('fill', 'rgba(33, 150, 243, 0.25)');
    polygon.setAttribute('stroke', '#2196f3');
    polygon.setAttribute('stroke-width', 2.5);
    polygon.setAttribute('stroke-linejoin', 'round');
    polygon.setAttribute('filter', 'url(#glow)');
    svgElement.appendChild(polygon);
    
    // 添加数据点（美化：在每个顶点添加小圆点）
    dimensions.forEach((dim, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const r = radius * dim.value;
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);
        
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', x);
        dot.setAttribute('cy', y);
        dot.setAttribute('r', 3);
        dot.setAttribute('fill', '#2196f3');
        dot.setAttribute('stroke', '#fff');
        dot.setAttribute('stroke-width', 1.5);
        svgElement.appendChild(dot);
    });
    
    // 同步右侧公式与自定义输入面板
    updateRadarFormulaPanel(lastRadarComputed);
    syncRadarInputsWithValues(lastRadarComputed);
    
    console.log('雷达图更新完成');
}

// ============================================================
// 认知领域分析PHP图（Parallel Histogram Plot）
// ============================================================

// 22条题目数据（按照规则要求的分布）- 已移动到数据文件 questionData.json
// 数据现在从 /data/questionData.json 加载
/*
const _deprecated_questionData_comment = [
    // 第1题：一、（1）- 概念性/应用/中/简答
    {"questionId": "Q1", "knowledgeType": "概念性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "试写出关系模式T的基本函数依赖集和候选码"},
    // 第2题：一、（2）- 概念性/应用/中/简答
    {"questionId": "Q2", "knowledgeType": "概念性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "说明T不是2NF模式的理由，并把T分解成2NF模式集"},
    // 第3题：一、（3）- 概念性/应用/中/简答
    {"questionId": "Q3", "knowledgeType": "概念性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "再进而分解成3NF模式集"},
    // 第4题：二、（1）- 程序性/应用/中/简答
    {"questionId": "Q4", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "用关系代数查询不是机械工业出版社出版的科幻类型图书BID"},
    // 第5题：二、（2）- 程序性/应用/中/简答
    {"questionId": "Q5", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "用关系代数查询至少出版了作者ID为A1所著的全部图书的出版社PID"},
    // 第6题：二、（3）- 程序性/应用/易/简答
    {"questionId": "Q6", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "用SQL语句查询出版社PID为P1的图书类型为科幻的图书ID"},
    // 第7题：二、（4）- 程序性/应用/中/简答
    {"questionId": "Q7", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "用SQL语句查询城市不是上海的出版社出版的图书的图书ID"},
    // 第8题：二、（5）- 程序性/应用/易/简答
    {"questionId": "Q8", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "用SQL语句将全部科幻类型图书的类型改为奇幻"},
    // 第9题：二、（6）- 程序性/应用/易/简答
    {"questionId": "Q9", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "用SQL语句将(A2,B4,P6,300)插入出版情况表"},
    // 第10题：二、（7）- 程序性/应用/易/简答
    {"questionId": "Q10", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "用SQL语句将Publishes表中作者名为张三的出版信息删除"},
    // 第11题：二、（8）- 程序性/应用/中/简答
    {"questionId": "Q11", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "用SQL语句查询每个作者出版图书的数量，输出作者名、出版图书数量，按照图书数量降序排序"},
    // 第12题：三、（1）- 程序性/应用/中/简答
    {"questionId": "Q12", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "使用T-SQL语句在Salary数据库中创建一个名为T_PRO的存储过程"},
    // 第13题：三、（2）- 程序性/应用/中/简答
    {"questionId": "Q13", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "中", "questionType": "简答", "description": "在教师表(teacher)上创建一个insert触发器trisex"},
    // 第14题：三、（3）- 程序性/应用/易/简答
    {"questionId": "Q14", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "在teacher表的教师姓名(Tname)字段上建立唯一非聚索引IDX_Tname"},
    // 第15题：三、（4）- 概念性/理解/易/填空
    {"questionId": "Q15", "knowledgeType": "概念性", "bloomGoal": "理解", "difficulty": "易", "questionType": "填空", "description": "写出下列程序段的功能注释"},
    // 第16题：三、（5）- 程序性/应用/易/填空
    {"questionId": "Q16", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "填空", "description": "下面是游标的使用程序，根据上下句意完成程序填空"},
    // 第17题：三、（6）- 程序性/应用/易/简答
    {"questionId": "Q17", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "创建一个默认对象de_teacher，其值为副教授"},
    // 第18题：三、（7）- 程序性/应用/易/简答
    {"questionId": "Q18", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "使用T-SQL语句创建一个视图TCview"},
    // 第19题：四、（1）- 元认知/创造/难/案例分析
    {"questionId": "Q19", "knowledgeType": "元认知", "bloomGoal": "创造", "difficulty": "难", "questionType": "案例分析", "description": "试画出E-R图，并在图上注明主要属性、联系类型、实体标识符"},
    // 第20题：四、（2）- 概念性/应用/中/案例分析
    {"questionId": "Q20", "knowledgeType": "概念性", "bloomGoal": "应用", "difficulty": "中", "questionType": "案例分析", "description": "将E-R图转换成关系模型，并说明主键和外键"},
    // 第21题：四、（3）- 元认知/创造/难/简答
    {"questionId": "Q21", "knowledgeType": "元认知", "bloomGoal": "创造", "difficulty": "难", "questionType": "简答", "description": "使用SQL命令创建security数据库，并在数据库中创学习表、安全知识表"},
    // 第22题：四、（4）- 程序性/应用/易/简答
    {"questionId": "Q22", "knowledgeType": "程序性", "bloomGoal": "应用", "difficulty": "易", "questionType": "简答", "description": "为user2用户授予对知识点表的插入、修改记录的权限"}
];
*/

// Bloom's taxonomy color encoding
const bloomGoalColors = {
    'Apply': '#8da0cb',
    'Analyze': '#fc8d59',
    'Create': '#aed5c5',
    'Remember': '#e0e0e0',
    'Understand': '#e0e0e0',
    'Evaluate': '#e0e0e0'
};

// PHP chart axis config (global state)
// Question type color palette (dynamic)
const questionTypeColorPalette = [
    '#8dd3c7',  // cyan
    '#ffffb3',  // yellow
    '#bebada',  // purple
    '#fb8072',  // red
    '#80b1d3',  // blue
    '#fdb462',  // orange
    '#b3de69',  // green
    '#fccde5',  // pink
    '#d9d9d9',  // gray
    '#bc80bd'   // magenta
];

// 枚举值 → 中文显示映射（内部 key 保持英文，渲染时转中文）
const ENUM_LABEL_CN = {
    // 知识类型
    'Factual': '事实性',
    'Conceptual': '概念性',
    'Procedural': '程序性',
    'Metacog.': '元认知',
    'Metacognitive': '元认知',
    // Bloom 层级
    'Remember': '记忆',
    'Understand': '理解',
    'Apply': '应用',
    'Analyze': '分析',
    'Evaluate': '评价',
    'Create': '创造',
    // 难度
    'Easy': '易',
    'Medium': '中',
    'Hard': '难',
    // 常见题型
    'MCQ': '选择题',
    'Blank': '填空题',
    'Solution': '解答题',
    'Essay': '论述题',
    'Case': '案例分析',
    'Short Answer': '简答题',
    'Calculation': '计算题',
    'Comprehensive': '综合题',
    'Fill-in-the-blank': '填空题'
};

function cnLabel(v) {
    return (v in ENUM_LABEL_CN) ? ENUM_LABEL_CN[v] : (v || '');
}

let phpAxesConfig = [
    { 
        name: '知识类型',
        field: 'knowledgeType', 
        x: 120,
        values: ['Factual', 'Conceptual', 'Procedural', 'Metacog.'],
        colors: {
            'Factual': '#a6cee3',
            'Conceptual': '#1f78b4',
            'Procedural': '#b2df8a',
            'Metacog.': '#33a02c',
            'Metacognitive': '#33a02c' // 兼容原始长名称
        }
    },
    { 
        name: 'Bloom 层级',
        field: 'bloomGoal', 
        x: 340, 
        isPivot: true,
        values: ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'],
        colors: {
            'Remember': '#fbb4ae',
            'Understand': '#b3cde3',
            'Apply': '#ccebc5',
            'Analyze': '#decbe4',
            'Evaluate': '#e5d8bd',
            'Create': '#fed9a6'
        }
    },
    { 
        name: '难度',
        field: 'difficulty', 
        x: 560,
        values: ['Easy', 'Medium', 'Hard'],
        colors: {
            'Easy': '#66c2a5',
            'Medium': '#fc8d62',
            'Hard': '#8da0cb'
        }
    },
    { 
        name: '题型',
        field: 'questionType', 
        x: 780,
        values: [],  // Dynamic from data
        colors: {}   // Dynamic
    }
];

// 动态更新题型轴的值和颜色（根据数据自动提取）
function updateQuestionTypeAxis() {
    // 从 questionData 中提取所有唯一的题型值
    const questionTypes = [...new Set(questionData.map(q => q.questionType).filter(v => v))];
    
    // 找到题型轴
    const questionTypeAxis = phpAxesConfig.find(axis => axis.field === 'questionType');
    if (questionTypeAxis) {
        questionTypeAxis.values = questionTypes;
        
        // 为每个题型分配颜色
        questionTypeAxis.colors = {};
        questionTypes.forEach((type, index) => {
            questionTypeAxis.colors[type] = questionTypeColorPalette[index % questionTypeColorPalette.length];
        });
        
        console.log('题型轴已更新:', questionTypes);
    }
}

// 全局变量：当前筛选的颜色（用于点击固定）
let selectedFilterColor = null;
// 全局变量：当前hover的颜色（用于临时显示）
let hoveredFilterColor = null;

/**
 * 清洗 questionData 中的非标准属性值，将其映射到最近的标准值。
 * 防止 Parallel Set 出现无颜色映射的黑色流线。
 */
function sanitizeQuestionDataForPHP() {
    var bloomFallbackMap = {
        'Prove': 'Analyze',
        'prove': 'Analyze',
        'Design': 'Create',
        'design': 'Create',
        'Implement': 'Apply',
        'implement': 'Apply',
        'Comprehend': 'Understand',
        'comprehend': 'Understand',
        'Recall': 'Remember',
        'recall': 'Remember',
        'Judge': 'Evaluate',
        'judge': 'Evaluate',
        'Synthesis': 'Create',
        'synthesis': 'Create'
    };
    
    var validBlooms = new Set(['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']);
    var validKnowledge = new Set(['Factual', 'Conceptual', 'Procedural', 'Metacognitive', 'Metacog.']);
    var validDifficulty = new Set(['Easy', 'Medium', 'Hard']);
    
    questionData.forEach(q => {
        // bloomGoal 清洗
        if (q.bloomGoal && !validBlooms.has(q.bloomGoal)) {
            var mapped = bloomFallbackMap[q.bloomGoal] || 'Apply';
            console.warn(`[数据清洗] Q${q.questionId} bloomGoal "${q.bloomGoal}" → "${mapped}"`);
            q.bloomGoal = mapped;
        }
        // knowledgeType 清洗
        if (q.knowledgeType && !validKnowledge.has(q.knowledgeType)) {
            console.warn(`[数据清洗] Q${q.questionId} knowledgeType "${q.knowledgeType}" → "Conceptual"`);
            q.knowledgeType = 'Conceptual';
        }
        // difficulty 清洗
        if (q.difficulty && !validDifficulty.has(q.difficulty)) {
            console.warn(`[数据清洗] Q${q.questionId} difficulty "${q.difficulty}" → "Medium"`);
            q.difficulty = 'Medium';
        }
    });
}

// 初始化PHP图
function initializePHPChart() {
    console.log('初始化PHP图...');
    
    // 清洗非标准属性值，防止黑色流线
    sanitizeQuestionDataForPHP();
    
    // 动态更新题型轴的值（根据数据自动提取）
    updateQuestionTypeAxis();
    
    const svg = d3.select('#php-chart');
    svg.selectAll('*').remove(); // 清空
    
    // 获取容器尺寸
    const width = 900;
    const height = 600; // 增加高度
    
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    
    // 绘制标题（左上角）
    svg.append('text')
        .attr('x', 0) // 左对齐，不留空
        .attr('y', 20) // 稍微调整y坐标，确保文字垂直居中
        .attr('text-anchor', 'start')
        .attr('font-size', '16px')
        .attr('font-weight', 'bold')
        .attr('fill', '#333')
        .text('认知维度分析 - 平行集图');
    
    const topMargin = 60; // 减少顶部空白
    const bottomMargin = 560; // 增加底部空间，减少底部空白
    
    // 使用全局配置
    const axes = phpAxesConfig;
    
    // 找到当前基准轴
    const pivotAxis = axes.find(a => a.isPivot);
    
    console.log('当前基准轴:', pivotAxis.name);
    
    // 为每道题分配基准轴的颜色
    questionData.forEach(q => {
        q.pivotColor = pivotAxis.colors[q[pivotAxis.field]];
    });
    
    // 为每个轴绘制
    axes.forEach(axis => {
        drawPHPAxis(svg, axis, topMargin, bottomMargin, axes, pivotAxis);
    });
    
    // 绘制22道题的平行坐标折线
    drawParallelLines(svg, axes, topMargin, bottomMargin, pivotAxis);
    
    // 绘制颜色图例（右上角，显示基准轴的颜色，可点击筛选）
    drawColorLegend(svg, 780, 20, pivotAxis);
    
    console.log('PHP图初始化完成');
}

// 绘制Parallel Set轴（节点高度按题目数量分配）
function drawPHPAxis(svg, axis, topMargin, bottomMargin, allAxes, pivotAxis) {
    const axisLength = bottomMargin - topMargin;
    const minNodeHeight = 20; // 最小节点高度
    
    // 绘制轴标题（可点击切换基准轴）
    svg.append('text')
        .attr('x', axis.x)
        .attr('y', topMargin - 20)
        .attr('text-anchor', 'middle')
        .attr('font-size', '13px')
        .attr('font-weight', 'bold')
        .attr('fill', axis.isPivot ? '#31a354' : '#333')
        .attr('cursor', 'pointer')
        .text(axis.name)
        .on('click', function() {
            // 切换基准轴
            allAxes.forEach(a => a.isPivot = false);
            axis.isPivot = true;
            // 重新绘制整个图
            initializePHPChart();
            // 更新环形图
            updateDonutChart(axis);
        })
        .on('mouseover', function() {
            d3.select(this).attr('fill', '#31a354');
        })
        .on('mouseout', function() {
            d3.select(this).attr('fill', axis.isPivot ? '#31a354' : '#333');
        });
    
    // 绘制轴线（美化：渐变、阴影）
    svg.append('line')
        .attr('x1', axis.x)
        .attr('y1', topMargin)
        .attr('x2', axis.x)
        .attr('y2', bottomMargin)
        .attr('stroke', axis.isPivot ? '#31a354' : '#ccc')
        .attr('stroke-width', axis.isPivot ? 4 : 2)
        .style('filter', axis.isPivot ? 'drop-shadow(0 0 4px rgba(49,163,84,0.4))' : 'none');
    
    // 统计每个轴值的数据和题目数量
    const dataGroups = d3.group(questionData, d => d[axis.field]);
    const valueCounts = axis.values.map(value => {
        const items = dataGroups.get(value) || [];
        return { value, count: items.length, items };
    });
    
    // 计算每个轴值的权重（count为0的给0.5，其他按count）
    const valueWeights = valueCounts.map(({ value, count }) => ({
        value,
        count,
        weight: count > 0 ? count : 0.5 // count为0的权重是0.5（count为1的一半）
    }));
    
    // 计算总权重
    const totalWeight = valueWeights.reduce((sum, v) => sum + v.weight, 0);
    
    // 计算每个轴值的位置（按权重分配区域，轴值点在区域中间）
    const nodePositions = {};
    const axisValuePositions = []; // 存储所有轴值的位置
    
    const availableHeight = bottomMargin - topMargin;
    let currentY = topMargin;
    
    // 计算每个轴值的区域
    valueCounts.forEach(({ value, count, items }, index) => {
        const weight = valueWeights[index].weight;
        
        // 计算区域高度（按权重比例）
        const segmentHeight = (weight / totalWeight) * availableHeight;
        
        // 区域的起始和结束位置
        const segmentStart = currentY;
        const segmentEnd = currentY + segmentHeight;
        
        // 轴值点在区域中间
        const centerY = segmentStart + segmentHeight / 2;
        
        // 确保最后一个区域结束在bottomMargin
        const finalEnd = index === valueCounts.length - 1 ? bottomMargin : segmentEnd;
        const finalCenter = index === valueCounts.length - 1 
            ? (segmentStart + (bottomMargin - segmentStart) / 2)
            : centerY;
        
        axisValuePositions.push({
            value: value,
            y: finalCenter, // 点位置在区域中间
            centerY: finalCenter, // 用于流线连接
            segmentStart: segmentStart, // 区域起始
            segmentEnd: finalEnd, // 区域结束
            count: count,
            items: items,
            segmentHeight: finalEnd - segmentStart
        });
        
        nodePositions[value] = {
            y: segmentStart,
            centerY: finalCenter, // 区域中心，用于流线连接
            height: finalEnd - segmentStart, // 区域高度
            endY: finalEnd, // 区域结束位置
            segmentStart: segmentStart, // 区域起始
            segmentEnd: finalEnd, // 区域结束
            count: count,
            items: items
        };
        
        currentY = finalEnd;
    });
    
    // 绘制点和标签（所有轴值都绘制，包括count为0的）
    axisValuePositions.forEach(({ value, y, count, items, segmentStart, segmentEnd }) => {
        // 绘制轴值点（在轴上，x坐标就是axis.x，位置在区域中间）
        const pointRadius = count > 0 ? 5 : 3; // count为0的点稍小一些
        const pointOpacity = count > 0 ? 1 : 0.5; // count为0的点半透明
        
        svg.append('circle')
            .attr('cx', axis.x) // 点在轴上
            .attr('cy', y) // y坐标在区域中间
            .attr('r', pointRadius)
            .attr('fill', axis.isPivot ? '#31a354' : '#666')
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
            .attr('opacity', pointOpacity)
            .style('cursor', count > 0 ? 'pointer' : 'default')
            .style('filter', 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))')
            .datum({ value, count, items, axis, segmentStart, segmentEnd })
            .on('mouseover', function(event) {
                if (count > 0) {
                    d3.select(this)
                        .attr('r', pointRadius * 1.3)
                        .attr('fill', '#2166ac')
                        .style('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))');
                    
                    showTooltip(`${cnLabel(value)}：${count} 题`, event);
                }
            })
            .on('mouseout', function() {
                if (count > 0) {
                    d3.select(this)
                        .attr('r', pointRadius)
                        .attr('fill', axis.isPivot ? '#31a354' : '#666')
                        .style('filter', 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))');
                    
                    hideTooltip();
                }
            });
        
        // 轴值标签（在轴左侧，位置在区域中间）
        svg.append('text')
            .attr('x', axis.x - 10)
            .attr('y', y)
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', '11px')
            .attr('fill', '#333')
            .attr('opacity', 1)
            .text(`${cnLabel(value)} (${count})`);
    });
    
    // 存储节点位置信息到axis对象中，供后续绘制流线使用
    axis.nodePositions = nodePositions;
}

// 绘制Parallel Set流线（相邻轴之间的连接）
function drawParallelLines(svg, axes, topMargin, bottomMargin, pivotAxis) {
    // 创建流线组（在轴的下层）
    const flowsGroup = svg.insert('g', ':first-child')
        .attr('class', 'parallel-set-flows');
    
    // 为相邻轴对绘制流线
    for (let i = 0; i < axes.length - 1; i++) {
        const sourceAxis = axes[i];
        const targetAxis = axes[i + 1];
        
        // 确保节点位置信息已计算
        if (!sourceAxis.nodePositions || !targetAxis.nodePositions) {
            continue;
        }
        
        // 计算从源轴到目标轴的流线数据
        const flows = [];
        
        // 遍历所有题目，统计流线
        questionData.forEach(q => {
            const sourceValue = q[sourceAxis.field];
            const targetValue = q[targetAxis.field];
            const pivotValue = q[pivotAxis.field];
            const pivotColor = pivotAxis.colors[pivotValue];
            
            // 查找或创建流线
            const flowKey = `${sourceValue}|${targetValue}|${pivotColor}`;
            let flow = flows.find(f => f.key === flowKey);
            
            if (!flow) {
                const sourceNode = sourceAxis.nodePositions[sourceValue];
                const targetNode = targetAxis.nodePositions[targetValue];
                
                if (sourceNode && targetNode && sourceNode.count > 0 && targetNode.count > 0) {
                    flow = {
                        key: flowKey,
                        sourceValue: sourceValue,
                        targetValue: targetValue,
                        sourceY: sourceNode.centerY, // 区域中心位置
                        targetY: targetNode.centerY, // 区域中心位置
                        sourceTop: sourceNode.segmentStart || sourceNode.y, // 区域起始
                        sourceBottom: sourceNode.segmentEnd || (sourceNode.y + sourceNode.height), // 区域结束
                        targetTop: targetNode.segmentStart || targetNode.y, // 区域起始
                        targetBottom: targetNode.segmentEnd || (targetNode.y + targetNode.height), // 区域结束
                        color: pivotColor,
                        questions: [],
                        count: 0
                    };
                    flows.push(flow);
                }
            }
            
            if (flow) {
                flow.questions.push(q);
                flow.count++;
            }
        });
        
        // 定义每道题对应的像素宽度（基础值，会根据区域自动缩放）
        const basePixelsPerQuestion = 20; // 基础像素宽度
        
        // 先计算源轴上的位置：按源值分组，然后按颜色排序堆叠
        const sourceGroups = d3.group(flows, f => f.sourceValue);
        const sourcePositions = new Map(); // 存储每条流线在源轴上的位置
        
        sourceGroups.forEach((sourceFlows, sourceValue) => {
            const sourceNode = sourceAxis.nodePositions[sourceValue];
            if (!sourceNode) return;
            
            const sourceStart = sourceNode.segmentStart || sourceNode.y;
            const sourceEnd = sourceNode.segmentEnd || (sourceNode.y + sourceNode.height);
            const sourceHeight = sourceEnd - sourceStart;
            
            // 计算这个源值的所有流线的总题目数
            const totalQuestionCount = sourceFlows.reduce((sum, f) => sum + f.count, 0);
            
            // 始终缩放以填满整个区域（无论是放大还是缩小）
            const scaleFactor = totalQuestionCount > 0 ? sourceHeight / totalQuestionCount : 1;
            
            // 按颜色排序（按基准轴顺序），确保相同颜色的流线堆叠在一起
            sourceFlows.sort((a, b) => {
                const aPivotValue = a.questions[0]?.[pivotAxis.field];
                const bPivotValue = b.questions[0]?.[pivotAxis.field];
                const aIndex = pivotAxis.values.indexOf(aPivotValue);
                const bIndex = pivotAxis.values.indexOf(bPivotValue);
                return (aIndex - bIndex);
            });
            
            // 从源区域起始位置开始，向下堆叠
            let currentSourceY = sourceStart;
            sourceFlows.forEach(flow => {
                const flowWidth = flow.count * scaleFactor; // 直接用题目数 * 缩放因子
                sourcePositions.set(flow.key, {
                    sourceTop: currentSourceY,
                    sourceBottom: currentSourceY + flowWidth,
                    sourceStart: sourceStart,
                    sourceEnd: sourceEnd,
                    scaleFactor: scaleFactor
                });
                currentSourceY += flowWidth;
            });
        });
        
        // 再计算目标轴上的位置：按目标值分组，然后按颜色排序堆叠
        const targetGroups = d3.group(flows, f => f.targetValue);
        const targetPositions = new Map(); // 存储每条流线在目标轴上的位置
        
        targetGroups.forEach((targetFlows, targetValue) => {
            const targetNode = targetAxis.nodePositions[targetValue];
            if (!targetNode) return;
            
            const targetStart = targetNode.segmentStart || targetNode.y;
            const targetEnd = targetNode.segmentEnd || (targetNode.y + targetNode.height);
            const targetHeight = targetEnd - targetStart;
            
            // 计算这个目标值的所有流线的总题目数
            const totalQuestionCount = targetFlows.reduce((sum, f) => sum + f.count, 0);
            
            // 始终缩放以填满整个区域（无论是放大还是缩小）
            const scaleFactor = totalQuestionCount > 0 ? targetHeight / totalQuestionCount : 1;
            
            // 按颜色排序（按基准轴顺序），确保相同颜色的流线堆叠在一起
            targetFlows.sort((a, b) => {
                const aPivotValue = a.questions[0]?.[pivotAxis.field];
                const bPivotValue = b.questions[0]?.[pivotAxis.field];
                const aIndex = pivotAxis.values.indexOf(aPivotValue);
                const bIndex = pivotAxis.values.indexOf(bPivotValue);
                return (aIndex - bIndex);
            });
            
            // 从目标区域起始位置开始，向下堆叠
            let currentTargetY = targetStart;
            targetFlows.forEach(flow => {
                const flowWidth = flow.count * scaleFactor; // 直接用题目数 * 缩放因子
                targetPositions.set(flow.key, {
                    targetTop: currentTargetY,
                    targetBottom: currentTargetY + flowWidth,
                    targetStart: targetStart,
                    targetEnd: targetEnd,
                    scaleFactor: scaleFactor
                });
                currentTargetY += flowWidth;
            });
        });
        
        // 绘制所有流线
        flows.forEach(flow => {
            const sourcePos = sourcePositions.get(flow.key);
            const targetPos = targetPositions.get(flow.key);
            
            if (!sourcePos || !targetPos) return;
            
            // 确保不超出区域边界
            const finalSourceTop = Math.max(sourcePos.sourceStart, Math.min(sourcePos.sourceTop, sourcePos.sourceEnd));
            const finalSourceBottom = Math.max(sourcePos.sourceStart, Math.min(sourcePos.sourceBottom, sourcePos.sourceEnd));
            const finalTargetTop = Math.max(targetPos.targetStart, Math.min(targetPos.targetTop, targetPos.targetEnd));
            const finalTargetBottom = Math.max(targetPos.targetStart, Math.min(targetPos.targetBottom, targetPos.targetEnd));
            
            // 判断是否应该显示这条流线（默认显示所有，有筛选时只显示选中的）
            const isSelected = selectedFilterColor !== null && flow.color === selectedFilterColor;
            const isHovered = hoveredFilterColor !== null && flow.color === hoveredFilterColor;
            const isVisible = selectedFilterColor === null ? true : isSelected;
            
            // 绘制流线（使用贝塞尔曲线）
            const sourceX = sourceAxis.x;
            const targetX = targetAxis.x;
            const controlX1 = sourceX + (targetX - sourceX) * 0.3;
            const controlX2 = sourceX + (targetX - sourceX) * 0.7;
            
            // 创建流线路径（使用贝塞尔曲线）
            // 起点和终点不重合，从源区域的起始到结束，连接到目标区域的起始到结束
            const pathData = `
                M ${sourceX},${finalSourceTop}
                C ${controlX1},${finalSourceTop} ${controlX2},${finalTargetTop} ${targetX},${finalTargetTop}
                L ${targetX},${finalTargetBottom}
                C ${controlX2},${finalTargetBottom} ${controlX1},${finalSourceBottom} ${sourceX},${finalSourceBottom}
                Z
            `;
            
            const pathElement = flowsGroup.append('path')
                .attr('d', pathData)
                .attr('fill', flow.color)
                .attr('opacity', isVisible ? 0.5 : 0.05)
                .attr('stroke', flow.color)
                .attr('stroke-width', 0.5)
                .attr('class', 'parallel-set-flow')
                .attr('data-color', flow.color)
                .attr('data-count', flow.count)
                .style('cursor', 'pointer')
                .style('filter', isVisible ? 'drop-shadow(0 0 2px rgba(0,0,0,0.1))' : 'none')
                .datum(flow)
                .on('mouseover', function(event) {
                    const flowData = d3.select(this).datum();
                    const flowIsVisible = selectedFilterColor === null ? true : (selectedFilterColor === flowData.color);
                    if (flowIsVisible || hoveredFilterColor === flowData.color) {
                        d3.select(this)
                            .attr('opacity', 0.9)
                            .style('filter', 'drop-shadow(0 0 4px rgba(0,0,0,0.3))');
                        
                        // 显示tooltip - 只显示题号
                        const labels = [];
                        flowData.questions.forEach((q) => {
                            const content = questionContentMap[q.questionId];
                            if (content && content.label) {
                                labels.push(content.label);
                            }
                        });
                        const tooltipText = `<div style="text-align: left; max-width: 300px; font-size: 12px; color: #000;">${labels.join('、')}</div>`;
                        showTooltip(tooltipText, event);
                    }
                })
                .on('mouseout', function() {
                    const flowData = d3.select(this).datum();
                    const flowIsVisible = selectedFilterColor === null ? true : (selectedFilterColor === flowData.color);
                    if (flowIsVisible || hoveredFilterColor === flowData.color) {
                        d3.select(this)
                            .attr('opacity', flowIsVisible ? 0.5 : 0.05)
                            .style('filter', 'drop-shadow(0 0 2px rgba(0,0,0,0.1))');
                        hideTooltip();
                    }
                })
                .on('click', function(event) {
                    event.stopPropagation();
                    const flowData = d3.select(this).datum();
                    console.log('流线被点击:', flowData.sourceValue, '→', flowData.targetValue, '包含题目数:', flowData.questions.length);
                    showMultipleQuestionsDetailFromPHP(flowData.questions);
                });
        });
    }
    
    // 🌟 单独绘制预览题目的金色路径（在所有流线之上）
    drawPreviewQuestionPath(svg, axes, topMargin, bottomMargin);
}

// 🌟 单独绘制预览题目的金色细线路径
function drawPreviewQuestionPath(svg, axes, topMargin, bottomMargin) {
    // 移除旧的预览路径
    svg.selectAll('.preview-question-path').remove();
    
    // 检查是否有预览题目
    const previewIds = window._previewQuestionIds || [];
    if (previewIds.length === 0) return;
    
    // 找到预览题目的数据
    const previewQuestion = questionData.find(q => previewIds.includes(q.questionId));
    if (!previewQuestion) {
        console.log('未找到预览题目数据');
        return;
    }
    
    console.log('🌟 绘制预览题目路径:', previewQuestion);
    
    // 创建预览路径组（在最上层）
    const previewGroup = svg.append('g')
        .attr('class', 'preview-question-path');
    
    // 计算每个轴上的位置
    const axisPositions = [];
    axes.forEach(axis => {
        const value = previewQuestion[axis.field];
        const nodePos = axis.nodePositions ? axis.nodePositions[value] : null;
        if (nodePos) {
            // 使用节点区域的中心位置
            const centerY = nodePos.segmentStart + (nodePos.segmentEnd - nodePos.segmentStart) / 2;
            axisPositions.push({
                x: axis.x,
                y: centerY,
                value: value,
                axisName: axis.name
            });
        }
    });
    
    if (axisPositions.length < 2) return;
    
    // 绘制连接线（金色细线）
    for (let i = 0; i < axisPositions.length - 1; i++) {
        const source = axisPositions[i];
        const target = axisPositions[i + 1];
        
        const controlX1 = source.x + (target.x - source.x) * 0.3;
        const controlX2 = source.x + (target.x - source.x) * 0.7;
        
        // 绘制金色曲线
        previewGroup.append('path')
            .attr('d', `M ${source.x},${source.y} C ${controlX1},${source.y} ${controlX2},${target.y} ${target.x},${target.y}`)
            .attr('fill', 'none')
            .attr('stroke', '#FFD700')
            .attr('stroke-width', 4)
            .attr('stroke-linecap', 'round')
            .style('filter', 'drop-shadow(0 0 6px rgba(255, 215, 0, 0.9))')
            .style('animation', 'preview-path-glow 1.5s ease-in-out infinite');
    }
    
    // 在每个轴上绘制金色圆点标记
    axisPositions.forEach(pos => {
        previewGroup.append('circle')
            .attr('cx', pos.x)
            .attr('cy', pos.y)
            .attr('r', 8)
            .attr('fill', '#FFD700')
            .attr('stroke', '#FFA500')
            .attr('stroke-width', 2)
            .style('filter', 'drop-shadow(0 0 4px rgba(255, 215, 0, 0.8))');
    });
}

// 更新流线可见性（hover时使用，无需重绘整个图）
function updateLineVisibility() {
    d3.selectAll('.parallel-set-flow').each(function() {
        const flow = d3.select(this);
        const flowColor = flow.attr('data-color');
        
        // 判断是否应该显示
        const isSelected = selectedFilterColor !== null && flowColor === selectedFilterColor;
        const isHovered = hoveredFilterColor !== null && flowColor === hoveredFilterColor;
        const isVisible = selectedFilterColor === null ? true : isSelected;
        
        // 更新样式
        if (selectedFilterColor === null && hoveredFilterColor !== null) {
            // 没有筛选，但有hover：高亮hover的颜色，淡化其他
            flow.transition()
                .duration(200)
                .attr('opacity', isHovered ? 0.8 : 0.1);
        } else {
            // 正常显示或筛选显示
            flow.transition()
                .duration(200)
                .attr('opacity', isVisible ? 0.5 : 0.05)
                .style('filter', isVisible ? 'drop-shadow(0 0 2px rgba(0,0,0,0.1))' : 'none');
        }
    });
}

// 🎯 高亮选中题目在平行集合图中的路径（预测性流线）
function highlightQuestionPathInPHP(questionId) {
    // 找到该题目的数据
    const qData = questionData.find(q => q.questionId === questionId);
    if (!qData) {
        console.log('未找到题目数据:', questionId);
        return;
    }
    
    console.log('高亮题目路径:', questionId, qData);
    
    // 获取 PHP 图的 SVG
    const svg = d3.select('#php-chart');
    if (svg.empty() || !phpAxesConfig) {
        console.log('PHP图未初始化');
        return;
    }
    
    // 移除之前的高亮路径
    svg.selectAll('.highlight-path').remove();
    
    // 淡化所有现有流线
    svg.selectAll('.parallel-set-flow')
        .transition()
        .duration(300)
        .attr('opacity', 0.1);
    
    // 使用全局轴配置
    const axes = phpAxesConfig;
    
    // 计算路径点（从轴的 nodePositions 获取）
    const pathPoints = [];
    axes.forEach(axis => {
        const value = qData[axis.field];
        if (axis.nodePositions && axis.nodePositions[value]) {
            const nodePos = axis.nodePositions[value];
            pathPoints.push({ 
                x: axis.x, 
                y: nodePos.centerY, 
                value: value, 
                axis: axis.name 
            });
        }
    });
    
    console.log('路径点:', pathPoints);
    
    // 如果找到路径点，绘制高亮路径
    if (pathPoints.length >= 2) {
        // 创建高亮路径组
        const highlightGroup = svg.append('g').attr('class', 'highlight-path');
        
        // 绘制连接线（发光效果）
        for (let i = 0; i < pathPoints.length - 1; i++) {
            const p1 = pathPoints[i];
            const p2 = pathPoints[i + 1];
            
            // 发光效果线（底层）
            highlightGroup.append('line')
                .attr('x1', p1.x)
                .attr('y1', p1.y)
                .attr('x2', p2.x)
                .attr('y2', p2.y)
                .attr('stroke', '#ff6b6b')
                .attr('stroke-width', 8)
                .attr('opacity', 0.4)
                .style('filter', 'blur(6px)');
            
            // 主线（虚线动画）
            highlightGroup.append('line')
                .attr('x1', p1.x)
                .attr('y1', p1.y)
                .attr('x2', p2.x)
                .attr('y2', p2.y)
                .attr('stroke', '#ff6b6b')
                .attr('stroke-width', 3)
                .attr('stroke-dasharray', '10,5')
                .attr('class', 'animated-dash');
        }
        
        // 绘制节点高亮圆
        pathPoints.forEach(p => {
            highlightGroup.append('circle')
                .attr('cx', p.x)
                .attr('cy', p.y)
                .attr('r', 10)
                .attr('fill', '#ff6b6b')
                .attr('stroke', '#fff')
                .attr('stroke-width', 3)
                .style('filter', 'drop-shadow(0 0 8px rgba(255,107,107,0.9))');
            
            // 节点值标签
            highlightGroup.append('text')
                .attr('x', p.x)
                .attr('y', p.y - 18)
                .attr('text-anchor', 'middle')
                .attr('font-size', '11px')
                .attr('font-weight', 'bold')
                .attr('fill', '#ff6b6b')
                .text(p.value);
        });
        
        // 显示路径标签（顶部）
        const labelText = pathPoints.map(p => p.value).join(' → ');
        highlightGroup.append('rect')
            .attr('x', 200)
            .attr('y', 8)
            .attr('width', 500)
            .attr('height', 28)
            .attr('rx', 14)
            .attr('fill', '#ff6b6b')
            .attr('opacity', 0.9);
        
        highlightGroup.append('text')
            .attr('x', 450)
            .attr('y', 27)
            .attr('text-anchor', 'middle')
            .attr('font-size', '13px')
            .attr('font-weight', 'bold')
            .attr('fill', '#fff')
            .text(`📍 Selected: ${labelText}`);
        
        console.log('绘制高亮路径:', labelText);
    }
    
    // 5秒后恢复正常显示
    setTimeout(() => {
        svg.selectAll('.highlight-path').remove();
        svg.selectAll('.parallel-set-flow')
            .transition()
            .duration(300)
            .attr('opacity', 0.5);
    }, 5000);
}

// 显示题目详情（从PHP图点击）- 单个题目
function showQuestionDetailFromPHP(question) {
    showMultipleQuestionsDetailFromPHP([question]);
}

// 显示多个题目详情（从PHP图点击组合线条）
function showMultipleQuestionsDetailFromPHP(questions) {
    console.log('showMultipleQuestionsDetailFromPHP 被调用，题目数:', questions.length);
    
    // 使用认知领域分析页面的显示区域
    const displayArea = document.getElementById('cognitive-content-display');
    
    if (!displayArea) {
        console.error('找不到显示区域元素 cognitive-content-display');
        return;
    }
    
    // 构建HTML显示所有题目
    let html = `<div style="background: #fff; padding: 15px; border-radius: 5px; border: 2px solid #3498db;">`;
    
    if (questions.length === 1) {
        // 单个题目显示
        const question = questions[0];
        const content = questionContentMap[question.questionId];
        if (content) {
            html += `
                <div style="display: flex; align-items: flex-start; gap: 15px;">
                    <div style="flex-shrink: 0; font-size: 18px; font-weight: bold; color: #3498db; min-width: 80px;">
                        ${content.label}
                    </div>
                    <div style="flex-grow: 1; font-size: 14px; color: #333; line-height: 1.6;">
                        ${content.content}
                    </div>
                    <div style="flex-shrink: 0; font-size: 16px; font-weight: bold; color: #e74c3c; min-width: 60px; text-align: right;">
                        ${content.score}
                    </div>
                </div>
            `;
        }
    } else {
        // 多个题目显示
        html += `<div style="font-size: 16px; font-weight: bold; color: #3498db; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #e0e0e0;">`;
        html += `本流路包含的题目（共 ${questions.length} 题）`;
        html += `</div>`;
        html += `<div style="max-height: 400px; overflow-y: auto;">`;
        
        questions.forEach((question, index) => {
            const content = questionContentMap[question.questionId];
            if (content) {
                html += `
                    <div style="margin-bottom: 15px; padding-bottom: 15px; ${index < questions.length - 1 ? 'border-bottom: 1px solid #f0f0f0;' : ''}">
                        <div style="display: flex; align-items: flex-start; gap: 15px; margin-bottom: 8px;">
                            <div style="flex-shrink: 0; font-size: 16px; font-weight: bold; color: #3498db; min-width: 80px;">
                                ${content.label}
                            </div>
                            <div style="flex-shrink: 0; font-size: 14px; font-weight: bold; color: #e74c3c; min-width: 60px; text-align: right;">
                                ${content.score}
                            </div>
                        </div>
                        <div style="font-size: 13px; color: #666; line-height: 1.6; margin-bottom: 6px;">
                            ${content.content}
                        </div>
                        <div style="font-size: 11px; color: #999;">
                            <span>${cnLabel(question.knowledgeType)}</span> · 
                            <span>${cnLabel(question.bloomGoal)}</span> · 
                            <span>${cnLabel(question.difficulty)}</span> · 
                            <span>${cnLabel(question.questionType)}</span>
                        </div>
                    </div>
                `;
            }
        });
        
        html += `</div>`;
    }
    
    html += `</div>`;
    
    displayArea.innerHTML = html;
}

    // 绘制颜色图例（右上角，纵向排列，只显示基准轴的颜色，可点击筛选）
function drawColorLegend(svg, x, y, pivotAxis) {
    // 根据基准轴生成图例数据（显示所有值）
    const legendData = [];
    pivotAxis.values.forEach(value => {
        const color = pivotAxis.colors[value];
        if (color) {
            legendData.push({ label: value, color: color });
        }
    });
    
    // 调整图例标题位置（不留空）
    const legendX = 820; // 靠右对齐
    const legendY = 20;  // 靠上对齐
    
    svg.append('text')
        .attr('x', legendX)
        .attr('y', legendY)
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .attr('fill', '#333')
        .attr('text-anchor', 'start')
        .text(`${pivotAxis.name}：`);
    
    // 纵向排列图例项（hover显示折线，点击固定）
    legendData.forEach((item, i) => {
        const itemY = legendY + 20 + i * 22;
        
        // 创建图例项组
        const legendItem = svg.append('g')
            .attr('class', 'legend-item')
            .style('cursor', 'pointer')
            .on('click', function() {
                // 切换筛选状态（点击固定）
                if (selectedFilterColor === item.color) {
                    selectedFilterColor = null; // 取消筛选
                } else {
                    selectedFilterColor = item.color; // 固定该颜色
                }
                
                // 重新绘制PHP图
                initializePHPChart();
            })
            .on('mouseover', function() {
                // hover时临时显示折线（如果没有固定选中的颜色）
                if (selectedFilterColor === null) {
                    hoveredFilterColor = item.color;
                    updateLineVisibility();
                }
                
                // 图例项高亮
                d3.select(this).select('rect')
                    .attr('stroke-width', 2)
                    .attr('stroke', '#000');
            })
            .on('mouseout', function() {
                // hover移出时隐藏折线（如果没有固定选中的颜色）
                if (selectedFilterColor === null) {
                    hoveredFilterColor = null;
                    updateLineVisibility();
                }
                
                // 恢复图例项样式
                d3.select(this).select('rect')
                    .attr('stroke-width', selectedFilterColor === item.color ? 2 : 1)
                    .attr('stroke', selectedFilterColor === item.color ? '#000' : '#999');
            });

        // 矩形色块
        legendItem.append('rect')
            .attr('x', legendX)
            .attr('y', itemY - 10)
            .attr('width', 12)
            .attr('height', 12)
            .attr('rx', 2)
            .attr('fill', item.color)
            .attr('stroke', selectedFilterColor === item.color ? '#000' : '#999')
            .attr('stroke-width', selectedFilterColor === item.color ? 2 : 1);
        
        // 文本标签
        legendItem.append('text')
            .attr('x', legendX + 18)
            .attr('y', itemY)
            .attr('font-size', '11px')
            .attr('fill', selectedFilterColor === item.color ? '#000' : '#666')
            .attr('font-weight', selectedFilterColor === item.color ? 'bold' : 'normal')
            .attr('dominant-baseline', 'middle')
            .text(cnLabel(item.label));
    });
    
    // 添加"显示全部"按钮（如果有筛选）
    if (selectedFilterColor !== null) {
        const resetY = legendY + 20 + legendData.length * 22 + 10;
        
        const resetButton = svg.append('g')
            .attr('class', 'reset-filter')
            .style('cursor', 'pointer')
            .on('click', function() {
                selectedFilterColor = null;
                initializePHPChart();
            })
            .on('mouseover', function() {
                d3.select(this).select('text')
                    .attr('fill', '#e74c3c');
            })
            .on('mouseout', function() {
                d3.select(this).select('text')
                    .attr('fill', '#3498db');
            });
        
        resetButton.append('text')
            .attr('x', legendX)
            .attr('y', resetY)
            .attr('font-size', '10px')
            .attr('fill', '#3498db')
            .attr('text-anchor', 'start')
            .attr('text-decoration', 'underline')
            .text('✕ Show all');
    }
}

// Tooltip显示
let tooltipDiv = null;
function showTooltip(content, event) {
    if (!tooltipDiv) {
        tooltipDiv = d3.select('body').append('div')
            .style('position', 'absolute')
            .style('background', 'rgba(240, 240, 240, 0.95)')  // 半透明浅白灰色
            .style('color', '#000')  // 黑色文字
            .style('padding', '10px 12px')
            .style('border-radius', '6px')
            .style('font-size', '12px')
            .style('box-shadow', '0 3px 10px rgba(0,0,0,0.2)')
            .style('pointer-events', 'none')
            .style('z-index', '10000')
            .style('max-width', '300px')
            .style('border', '1px solid rgba(200, 200, 200, 0.5)');  // 添加浅色边框
    }
    
    tooltipDiv
        .html(content)
        .style('display', 'block')
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY + 10) + 'px');
}

function hideTooltip() {
    if (tooltipDiv) {
        tooltipDiv.style('display', 'none');
    }
}

// 题目筛选（简化实现，仅在控制台输出）
function filterQuestions(questionIds) {
    console.log('筛选题目:', questionIds);
    alert(`选中题目: ${questionIds}`);
}

// ==================== 缺陷分析功能 ====================

// 存储各维度的缺陷信息
let dimensionDefects = {
    knowledge: [],
    cognitive: [],
    format: []
};

// 分析知识点覆盖维度的缺陷
function analyzeKnowledgeDefects(scoreData) {
    const defects = [];
    
    if (!scoreData) return defects;
    
    // 检查章节覆盖
    const uncoveredChapters = scoreData.totalChapters - scoreData.coveredChapters;
    if (uncoveredChapters > 0) {
        defects.push(`${uncoveredChapters} 个章节没有题目`);
    }
    
    // 检查达标率
    const nonMetChapters = scoreData.totalChapters - scoreData.metChapters;
    if (nonMetChapters > 0) {
        defects.push(`${nonMetChapters} 个章节关键知识点覆盖率低于 ${(scoreData.complianceRatio * 100).toFixed(0)}%`);
    }
    
    // 检查具体哪些章节缺少覆盖
    if (chapterData && chapterKnowledgeMap) {
        const lowCoverageChapters = [];
        chapterData.forEach(ch => {
            const kps = chapterKnowledgeMap[ch.id] || [];
            const actualCount = kps.length;
            const requiredCount = ch.keyPointsCount || 0;
            if (requiredCount > 0 && actualCount < requiredCount * scoreData.complianceRatio) {
                lowCoverageChapters.push(`${ch.name}：${actualCount}/${requiredCount} 个知识点`);
            }
        });
        if (lowCoverageChapters.length > 0 && lowCoverageChapters.length <= 3) {
            lowCoverageChapters.forEach(c => defects.push(c));
        } else if (lowCoverageChapters.length > 3) {
            defects.push(`${lowCoverageChapters.length} 个章节需要补充题目`);
        }
    }
    
    return defects;
}

// 分析认知维度的缺陷
function analyzeCognitiveDefects(scoreData) {
    const defects = [];
    
    if (!scoreData) return defects;
    
    // 知识类型缺陷（支持中英文）
    const allKnowledgeTypesEN = ['Factual', 'Conceptual', 'Procedural', 'Metacognitive'];
    const allKnowledgeTypesCN = ['事实性', '概念性', '程序性', '元认知'];
    const coveredTypes = scoreData.coveredKnowledgeTypes || [];
    
    // 检查是否有缺失的知识类型（检测覆盖的类型数量）
    const coveredCount = coveredTypes.length;
    if (coveredCount < 4) {
        // 判断数据是中文还是英文
        const isEnglish = coveredTypes.some(t => allKnowledgeTypesEN.includes(t));
        const allTypes = isEnglish ? allKnowledgeTypesEN : allKnowledgeTypesCN;
        const missingTypes = allTypes.filter(t => !coveredTypes.includes(t));
        if (missingTypes.length > 0) {
            const missingTypesCn = missingTypes.map(t => cnLabel(t));
            defects.push(`缺失知识类型：${missingTypesCn.join('、')}`);
        }
    }
    
    // 布鲁姆目标缺陷（支持中英文）
    const allBloomLevelsEN = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
    const allBloomLevelsCN = ['记忆', '理解', '应用', '分析', '评价', '创造'];
    const coveredBloom = scoreData.coveredBloomLevels || [];
    
    // 检查缺失的布鲁姆层级
    const bloomCount = coveredBloom.length;
    if (bloomCount < 4) {
        const isEnglish = coveredBloom.some(b => allBloomLevelsEN.includes(b));
        const allBloom = isEnglish ? allBloomLevelsEN : allBloomLevelsCN;
        const missingBloom = allBloom.filter(b => !coveredBloom.includes(b));
        if (missingBloom.length > 2) {
            const missingBloomCn = missingBloom.slice(0, 3).map(b => cnLabel(b));
            defects.push(`缺失 Bloom 层级：${missingBloomCn.join('、')}${missingBloom.length > 3 ? '…' : ''}`);
        }
    }
    
    // 难度分布缺陷
    if (scoreData.mediumRatio < 0.6) {
        defects.push(`中等难度占比偏低：${(scoreData.mediumRatio * 100).toFixed(0)}%（目标：>60%）`);
    }
    
    // 题型缺陷
    if (scoreData.typeCoverageCount < 3) {
        defects.push(`仅覆盖 ${scoreData.typeCoverageCount} 种题型，需要更多多样性`);
    }
    
    return defects;
}

// 分析形式规范维度的缺陷
function analyzeFormatDefects(scoreData) {
    const defects = [];
    
    if (!scoreData) return defects;
    
    // 篇幅合规率
    if (scoreData.complianceRate < 0.8) {
        defects.push(`篇幅合规率：${(scoreData.complianceRate * 100).toFixed(0)}%（${scoreData.compliantCount}/${scoreData.totalCount}）`);
    }
    
    // 规范表述准确率
    if (scoreData.accuracyRate < 0.9) {
        defects.push(`表述准确率：${(scoreData.accuracyRate * 100).toFixed(0)}%（检出 ${scoreData.totalErrors} 处问题）`);
    }
    
    // 具体错误类型
    if (formatImprovementData && formatImprovementData.length > 0) {
        const errorTypes = {};
        formatImprovementData.forEach(item => {
            const type = item.errorType || '未知';
            errorTypes[type] = (errorTypes[type] || 0) + 1;
        });
        const topErrors = Object.entries(errorTypes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([type, count]) => `${type}: ${count}`);
        if (topErrors.length > 0) {
            defects.push(`错误类型：${topErrors.join('、')}`);
        }
    }
    
    return defects;
}

// 更新缺陷显示
function updateDefectsDisplay() {
    // Knowledge defects
    const knowledgeDefectsEl = document.getElementById('knowledge-defects');
    if (knowledgeDefectsEl && dimensionDefects.knowledge) {
        if (dimensionDefects.knowledge.length > 0) {
            knowledgeDefectsEl.innerHTML = `
                <div class="defects-title">⚠ 检出问题：</div>
                ${dimensionDefects.knowledge.map(d => `<div class="defect-item">${d}</div>`).join('')}
            `;
            knowledgeDefectsEl.style.display = 'block';
        } else {
            knowledgeDefectsEl.innerHTML = '<div class="no-defects">未发现显著问题</div>';
            knowledgeDefectsEl.style.display = 'block';
        }
    }
    
    // Cognitive defects
    const cognitiveDefectsEl = document.getElementById('cognitive-defects');
    if (cognitiveDefectsEl && dimensionDefects.cognitive) {
        if (dimensionDefects.cognitive.length > 0) {
            cognitiveDefectsEl.innerHTML = `
                <div class="defects-title">⚠ 检出问题：</div>
                ${dimensionDefects.cognitive.map(d => `<div class="defect-item">${d}</div>`).join('')}
            `;
            cognitiveDefectsEl.style.display = 'block';
        } else {
            cognitiveDefectsEl.innerHTML = '<div class="no-defects">未发现显著问题</div>';
            cognitiveDefectsEl.style.display = 'block';
        }
    }
    
    // Format defects
    const formatDefectsEl = document.getElementById('format-defects');
    if (formatDefectsEl && dimensionDefects.format) {
        if (dimensionDefects.format.length > 0) {
            formatDefectsEl.innerHTML = `
                <div class="defects-title">⚠ 检出问题：</div>
                ${dimensionDefects.format.map(d => `<div class="defect-item">${d}</div>`).join('')}
            `;
            formatDefectsEl.style.display = 'block';
        } else {
            formatDefectsEl.innerHTML = '<div class="no-defects">未发现显著问题</div>';
            formatDefectsEl.style.display = 'block';
        }
    }
}

// 获取所有维度的缺陷汇总（用于 AI 生成）
function getAllDefectsSummary() {
    const summary = [];
    
    if (dimensionDefects.knowledge.length > 0) {
        summary.push(`【Knowledge Coverage Issues】\n${dimensionDefects.knowledge.map(d => '- ' + d).join('\n')}`);
    }
    
    if (dimensionDefects.cognitive.length > 0) {
        summary.push(`【Cognitive Analysis Issues】\n${dimensionDefects.cognitive.map(d => '- ' + d).join('\n')}`);
    }
    
    if (dimensionDefects.format.length > 0) {
        summary.push(`【Format & Length Issues】\n${dimensionDefects.format.map(d => '- ' + d).join('\n')}`);
    }
    
    return summary.join('\n\n');
}

// ==================== Edit 功能：Self-Polish 框架改进题目 ====================

// 存储生成的候选题目和选中题目
let candidateQuestionsData = [];
let selectedQuestionsData = [];
let previewingQuestionId = null;

// 预览数据：临时添加到视图中的题目（尚未Accept）
let previewQuestionForView = null;  // 当前点击预览的单个题目
let acceptedPreviewQuestions = [];  // 已Accept但未保存到文件的题目

/**
 * 将候选题目格式转换为视图所需的 questionData 格式
 * @param {Object} candidate - 候选题目对象
 * @returns {Object} - 转换后的 questionData 格式
 */
function convertCandidateToQuestionData(candidate) {
    const attrs = candidate.attributes || {};
    const newId = `Q_NEW_${candidate.id}`;
    
    const targetChapter = candidate.targetChapter || '';
    const targetDefect = candidate.targetDefect || '';
    const searchText = (targetDefect + ' ' + targetChapter).toLowerCase();
    
    let chapterId = null;
    let chapterName = targetChapter;
    
    // Strategy 1: Match explicit chapter number (e.g. "Chapter 6", "Ch.6", "第6章")
    const chapterMatch = searchText.match(/(?:chapter|ch\.?|第)\s*(\d+)/i);
    if (chapterMatch) {
        const matchedId = parseInt(chapterMatch[1]);
        const chapter = chapterData.find(c => c.id === matchedId);
        if (chapter) {
            chapterId = matchedId;
            chapterName = chapter.name;
        }
    }
    
    // Strategy 2: Exact chapter name match in text
    if (!chapterId) {
        for (const chapter of chapterData) {
            if (chapter.name && searchText.includes(chapter.name.toLowerCase())) {
                chapterId = chapter.id;
                chapterName = chapter.name;
                break;
            }
        }
    }
    
    // Strategy 3: Fuzzy keyword match — split chapter name into words, check overlap
    if (!chapterId) {
        let bestScore = 0;
        let bestChapter = null;
        for (const chapter of chapterData) {
            if (!chapter.name) continue;
            const nameWords = chapter.name.toLowerCase().split(/[\s,，、/\\()\[\]]+/).filter(w => w.length > 1);
            let score = 0;
            for (const word of nameWords) {
                if (searchText.includes(word)) score++;
            }
            // Also check against chapter description and keyPoints
            const descText = ((chapter.description || '') + ' ' + (chapter.keyPoints || '')).toLowerCase();
            const defectWords = searchText.split(/[\s,，、/\\()\[\]]+/).filter(w => w.length > 1);
            for (const dw of defectWords) {
                if (descText.includes(dw)) score += 0.5;
            }
            if (score > bestScore) {
                bestScore = score;
                bestChapter = chapter;
            }
        }
        if (bestScore >= 1 && bestChapter) {
            chapterId = bestChapter.id;
            chapterName = bestChapter.name;
        }
    }
    
    // Strategy 4: Fallback — assign to chapter with lowest coverage ratio
    if (!chapterId && chapterData.length > 0) {
        let lowestCoverage = Infinity;
        let fallbackChapter = chapterData[0];
        for (const ch of chapterData) {
            const kps = chapterKnowledgeMap[ch.id] || [];
            const required = ch.keyPointsCount || 1;
            const ratio = kps.length / required;
            if (ratio < lowestCoverage) {
                lowestCoverage = ratio;
                fallbackChapter = ch;
            }
        }
        chapterId = fallbackChapter.id;
        chapterName = fallbackChapter.name;
        console.log(`📌 章节匹配兜底: ${candidate.id} -> 覆盖最低的章节 ${chapterId} (${chapterName})`);
    }
    
    console.log(`📌 候选题目章节映射: ${candidate.id} -> 章节${chapterId || '未知'} (${chapterName || targetDefect})`);
    
    return {
        questionId: newId,
        knowledgeType: attrs.knowledgeType || 'Conceptual',
        bloomGoal: attrs.bloomLevel || 'Apply',
        difficulty: attrs.difficulty || 'Medium',
        questionType: attrs.questionType || 'Solution',
        description: candidate.improved ? candidate.improved.substring(0, 50) + '...' : '',
        chapterId: chapterId,
        chapterName: chapterName,
        targetDefect: targetDefect,
        isPreview: true,
        isNew: true,
        originalCandidate: candidate
    };
}

/**
 * 获取当前视图数据（包含预览题目）
 * @returns {Array} - 合并后的 questionData 数组
 */
function getQuestionDataWithPreviews() {
    let data = [...questionData];
    
    // 添加已Accept的预览题目
    acceptedPreviewQuestions.forEach(q => {
        if (!data.some(d => d.questionId === q.questionId)) {
            data.push({...q, isPreview: false, isAccepted: true});
        }
    });
    
    // 添加当前正在预览的题目
    if (previewQuestionForView) {
        if (!data.some(d => d.questionId === previewQuestionForView.questionId)) {
            data.push({...previewQuestionForView, isPreview: true});
        }
    }
    
    return data;
}

// 更新状态显示
function updateEditStatus(text, color = '#666') {
    const statusEl = document.getElementById('edit-status');
    if (statusEl) {
        statusEl.textContent = text;
        statusEl.style.color = color;
    }
}

// 更新选中题目计数
function updateSelectedCount() {
    const countEl = document.getElementById('selected-count');
    if (countEl) {
        countEl.textContent = selectedQuestionsData.length;
    }
}

// 渲染候选题目列表
function renderCandidateQuestions() {
    const candidateArea = document.getElementById('candidate-questions-area');
    const candidateList = document.getElementById('candidate-questions-list');
    
    if (!candidateArea || !candidateList) return;
    
    if (candidateQuestionsData.length === 0) {
        candidateArea.style.display = 'none';
        return;
    }
    
    candidateArea.style.display = 'block';
    
    let html = '';
    candidateQuestionsData.forEach((item, index) => {
        const attrs = item.attributes || {};
        const isSelected = selectedQuestionsData.some(q => q.id === item.id);
        const isPreviewing = previewingQuestionId === item.id;
        
        // 难度标签颜色
        let difficultyClass = '';
        if (attrs.difficulty === 'Easy') difficultyClass = 'easy';
        else if (attrs.difficulty === 'Medium') difficultyClass = 'medium';
        else if (attrs.difficulty === 'Hard') difficultyClass = 'hard';
        
        // 检查是否正在视图中预览
        const isViewPreviewing = previewQuestionForView?.originalCandidate?.id === item.id;
        
        html += `
            <div class="question-card ${isSelected ? 'selected' : ''} ${isPreviewing ? 'previewing' : ''} ${isViewPreviewing ? 'view-previewing' : ''}" 
                 data-question-id="${item.id}" 
                 onclick="selectAndPreviewQuestion('${item.id}')"
                 style="cursor: pointer;">
                <div class="question-card-header">
                    <span class="question-number">#${index + 1}</span>
                    <span class="question-tag knowledge">${cnLabel(attrs.knowledgeType) || '-'}</span>
                    <span class="question-tag bloom">${cnLabel(attrs.bloomLevel) || '-'}</span>
                    <span class="question-tag difficulty ${difficultyClass}">${cnLabel(attrs.difficulty) || '-'}</span>
                    ${isSelected ? '<span class="preview-badge">✓ 已选</span>' : ''}
                    ${isViewPreviewing && !isSelected ? '<span class="preview-badge">🔍 视图预览中</span>' : ''}
                </div>
                <div class="question-content">${escapeForKatex(item.improved || '-', 220)}</div>
                ${item.targetChapter ? `<div class="question-chapter">📚 目标章节：${item.targetChapter}</div>` : ''}
                ${item.targetDefect ? `<div class="question-defect">⚠️ ${item.targetDefect}</div>` : ''}
                ${item.explanation ? `<div class="question-explanation">💡 ${escapeForKatex(item.explanation, 200)}</div>` : ''}
            </div>
        `;
    });
    
    candidateList.innerHTML = html;
    typesetMath(candidateList);
}

// HTML 转义 + 截断（保留 LaTeX 分隔符以便 KaTeX 渲染）
function escapeForKatex(text, maxLen) {
    if (text == null) return '-';
    let s = String(text);
    if (typeof maxLen === 'number' && s.length > maxLen) {
        let cut = s.slice(0, maxLen);
        // 如果截断处把一对 $...$ 切成了奇数个 $，回退到上一个 $ 之前避免半截公式
        const dollarCount = (cut.match(/(?<!\\)\$/g) || []).length;
        if (dollarCount % 2 === 1) {
            const lastDollar = cut.lastIndexOf('$');
            if (lastDollar > 0) cut = cut.slice(0, lastDollar);
        }
        s = cut + '…';
    }
    // 仅转义会破坏 HTML 的字符；$、\\ 留给 KaTeX 处理
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

// 用 KaTeX auto-render 把 $...$ / $$...$$ / \(...\) / \[...\] 渲染成数学公式
function typesetMath(rootEl) {
    if (!rootEl || typeof window.renderMathInElement !== 'function') return;
    try {
        window.renderMathInElement(rootEl, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false }
            ],
            throwOnError: false,
            errorColor: '#cc0000',
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre']
        });
    } catch (e) {
        console.warn('KaTeX 渲染失败:', e);
    }
}

// 渲染选中题目列表
function renderSelectedQuestions() {
    const selectedArea = document.getElementById('selected-questions-area');
    const selectedList = document.getElementById('selected-questions-list');
    
    if (!selectedArea || !selectedList) return;
    
    if (selectedQuestionsData.length === 0) {
        selectedArea.style.display = 'none';
        return;
    }
    
    selectedArea.style.display = 'block';
    updateSelectedCount();
    
    let html = '';
    selectedQuestionsData.forEach((item, index) => {
        const attrs = item.attributes || {};
        
        // 难度标签颜色
        let difficultyClass = '';
        if (attrs.difficulty === 'Easy') difficultyClass = 'easy';
        else if (attrs.difficulty === 'Medium') difficultyClass = 'medium';
        else if (attrs.difficulty === 'Hard') difficultyClass = 'hard';
        
        html += `
            <div class="question-card selected" data-question-id="${item.id}">
                <button class="remove-btn" onclick="event.stopPropagation(); removeSelectedQuestion('${item.id}')">×</button>
                <div class="question-card-header">
                    <span class="question-number">#${index + 1}</span>
                    <span class="question-tag difficulty ${difficultyClass}">${cnLabel(attrs.difficulty) || '-'}</span>
                </div>
                <div class="question-content">${escapeForKatex(item.improved || '-', 100)}</div>
            </div>
        `;
    });
    
    selectedList.innerHTML = html;
    typesetMath(selectedList);
}

// 点击候选题目：同时切换选中状态 + 在视图中预览
function selectAndPreviewQuestion(questionId) {
    const question = candidateQuestionsData.find(q => q.id === questionId);
    if (!question) return;
    
    const existingIndex = selectedQuestionsData.findIndex(q => q.id === questionId);
    
    if (existingIndex >= 0) {
        // 已选中 → 取消选择，同时取消预览
        selectedQuestionsData.splice(existingIndex, 1);
        if (previewQuestionForView?.originalCandidate?.id === questionId) {
            cancelPreviewInViews();
        }
    } else {
        // 未选中 → 加入选中列表，同时预览
        selectedQuestionsData.push(question);
        clickToPreviewInViews(questionId);
    }
    
    if (selectedQuestionsData.length > 0) {
        updateEditStatus(`✓ 已选 ${selectedQuestionsData.length} 道`, '#4CAF50');
    } else {
        updateEditStatus('点击题目以选择', '#666');
    }
    renderCandidateQuestions();
    renderSelectedQuestions();
}

// 切换题目选择状态（保留兼容）
function toggleQuestionSelection(questionId) {
    selectAndPreviewQuestion(questionId);
}

// 从选中列表移除题目
function removeSelectedQuestion(questionId) {
    const index = selectedQuestionsData.findIndex(q => q.id === questionId);
    if (index >= 0) {
        selectedQuestionsData.splice(index, 1);
        updateEditStatus(`✓ 已选 ${selectedQuestionsData.length} 道`, '#4CAF50');
        renderCandidateQuestions();
        renderSelectedQuestions();
    }
}

// 预览题目（显示预测性视觉反馈）- 仅hover效果
function previewQuestion(questionId) {
    const question = candidateQuestionsData.find(q => q.id === questionId);
    if (!question) return;
    
    previewingQuestionId = questionId;
    
    // 更新预览信息
    const previewInfo = document.getElementById('preview-info');
    if (previewInfo && question.attributes) {
        const attrs = question.attributes;
        previewInfo.textContent = `预览中：${attrs.knowledgeType || '-'} / ${attrs.bloomLevel || '-'} / ${attrs.difficulty || '-'}`;
    }
    
    // 重新渲染候选列表以显示虚线边框
    renderCandidateQuestions();
}

// 点击候选题目：动态添加到 Treemap 和平行集合图中预览
function clickToPreviewInViews(questionId) {
    const question = candidateQuestionsData.find(q => q.id === questionId);
    if (!question) return;
    
    console.log('📍 点击预览题目:', questionId, question);
    
    // 如果已经在预览这道题，则取消预览
    if (previewQuestionForView && previewQuestionForView.originalCandidate?.id === questionId) {
        console.log('🔄 取消预览');
        cancelPreviewInViews();
    } else {
        // 转换为视图数据格式
        previewQuestionForView = convertCandidateToQuestionData(question);
        console.log('✨ 设置预览:', previewQuestionForView);
        updateEditStatus(`🔍 预览中：${question.attributes?.knowledgeType || '-'} → ${question.attributes?.difficulty || '-'}`, '#2196F3');
        
        // 刷新视图（添加预览数据）
        refreshViewsWithPreview();
    }
    
    renderCandidateQuestions();
}

// 取消视图预览
function cancelPreviewInViews() {
    previewQuestionForView = null;
    window._previewQuestionIds = [];
    updateEditStatus('已清除预览', '#666');
    
    // 恢复原始数据
    restoreOriginalQuestionData();
    renderCandidateQuestions();
}

// 显示预览指示器（固定在页面右下角）
function showPreviewIndicator(question) {
    // 移除旧的指示器
    hidePreviewIndicator();
    
    const attrs = question.attributes || {};
    const targetChapter = question.targetChapter || '';
    const targetDefect = question.targetDefect || '';
    
    // 获取转换后的数据中的章节信息
    const converted = previewQuestionForView;
    const chapterInfo = converted?.chapterId 
        ? `第${converted.chapterId}章 ${converted.chapterName || ''}` 
        : (targetChapter || '未指定章节');
    
    const indicator = document.createElement('div');
    indicator.id = 'preview-indicator';
    indicator.innerHTML = `
        <div class="preview-indicator-content">
            <div class="preview-indicator-title">🔍 预览新题目</div>
            <div class="preview-indicator-chapter">📚 ${chapterInfo}</div>
            <div class="preview-indicator-info">
                <span class="tag">${attrs.knowledgeType || '-'}</span>
                <span class="arrow">→</span>
                <span class="tag">${attrs.bloomLevel || '-'}</span>
                <span class="arrow">→</span>
                <span class="tag difficulty-${(attrs.difficulty || 'Medium').toLowerCase()}">${attrs.difficulty || '-'}</span>
            </div>
            ${targetDefect ? `<div class="preview-indicator-defect">🎯 ${targetDefect.substring(0, 50)}${targetDefect.length > 50 ? '...' : ''}</div>` : ''}
            <div class="preview-indicator-hint">点击题目或此处取消预览</div>
        </div>
    `;
    indicator.onclick = cancelPreviewInViews;
    document.body.appendChild(indicator);
}

// 隐藏预览指示器
function hidePreviewIndicator() {
    const existing = document.getElementById('preview-indicator');
    if (existing) {
        existing.remove();
    }
}

// 保存原始数据的备份
let _originalQuestionData = null;
let _originalChapterKnowledgeMap = null;

// 恢复原始 questionData 和 chapterKnowledgeMap
function restoreOriginalQuestionData() {
    console.log('🔙 恢复原始数据');
    if (_originalQuestionData) {
        questionData = [..._originalQuestionData];
    }
    if (_originalChapterKnowledgeMap) {
        chapterKnowledgeMap = JSON.parse(JSON.stringify(_originalChapterKnowledgeMap));
    }
    
    try {
        if (typeof initializePHPChart === 'function') {
            initializePHPChart();
        }
        if (typeof updateKnowledgeGrid === 'function') {
            updateKnowledgeGrid();
        }
    } catch (e) {
        console.error('恢复视图时出错:', e);
    }
}

// 将预览/已接受的题目注入 chapterKnowledgeMap，使 Treemap 能显示它们
function injectPreviewsIntoChapterKnowledgeMap() {
    // 首次调用时备份原始 chapterKnowledgeMap
    if (!_originalChapterKnowledgeMap) {
        _originalChapterKnowledgeMap = JSON.parse(JSON.stringify(chapterKnowledgeMap));
    }
    
    // 从备份恢复，避免重复注入
    chapterKnowledgeMap = JSON.parse(JSON.stringify(_originalChapterKnowledgeMap));
    
    // 收集所有需要注入的题目（已接受 + 当前预览）
    const allPreviewQuestions = [...acceptedPreviewQuestions];
    if (previewQuestionForView) {
        if (!allPreviewQuestions.some(q => q.questionId === previewQuestionForView.questionId)) {
            allPreviewQuestions.push(previewQuestionForView);
        }
    }
    
    allPreviewQuestions.forEach(q => {
        const chId = q.chapterId;
        if (!chId) return;
        
        if (!chapterKnowledgeMap[chId]) {
            chapterKnowledgeMap[chId] = [];
        }
        
        const kpName = q.targetDefect || q.chapterName || 'Supplementary';
        
        // Check if already injected
        const alreadyExists = chapterKnowledgeMap[chId].some(kp => 
            kp.questions && kp.questions.some(eq => eq.label === q.questionId)
        );
        if (alreadyExists) return;
        
        // Try to find an existing knowledge point to append to
        let placed = false;
        for (const kp of chapterKnowledgeMap[chId]) {
            if (kp.name && q.targetDefect && 
                (kp.name.toLowerCase().includes(q.targetDefect.substring(0, 10).toLowerCase()) ||
                 q.targetDefect.toLowerCase().includes(kp.name.toLowerCase()))) {
                kp.questions.push({ label: q.questionId, score: 5, isNew: true });
                placed = true;
                break;
            }
        }
        
        // If no match, create a new knowledge point entry
        if (!placed) {
            chapterKnowledgeMap[chId].push({
                name: kpName.substring(0, 30),
                questions: [{ label: q.questionId, score: 5, isNew: true }],
                isNew: true
            });
        }
        
        console.log(`📊 注入预览题目到 chapterKnowledgeMap: ${q.questionId} -> Ch.${chId}`);
    });
}

// 刷新视图（包含预览数据）
function refreshViewsWithPreview() {
    console.log('🔄 刷新视图（含预览数据）');
    
    // 首次调用时保存原始数据的备份
    if (!_originalQuestionData) {
        _originalQuestionData = [...questionData];
        console.log('💾 保存原始数据备份，题目数:', _originalQuestionData.length);
    }
    
    // 临时替换为包含预览的数据
    const dataWithPreviews = getQuestionDataWithPreviews();
    
    // 注入预览题目到 chapterKnowledgeMap（使 Treemap 可见）
    injectPreviewsIntoChapterKnowledgeMap();
    
    window._previewQuestionIds = [];
    if (previewQuestionForView) {
        window._previewQuestionIds.push(previewQuestionForView.questionId);
    }
    acceptedPreviewQuestions.forEach(q => {
        window._previewQuestionIds.push(q.questionId);
    });
    
    // 临时修改 questionData 以触发视图更新
    questionData = dataWithPreviews;
    
    try {
        // 刷新平行集合图
        if (typeof initializePHPChart === 'function') {
            console.log('📊 刷新平行集合图...');
            initializePHPChart();
        }
        
        // 刷新 Treemap（知识点覆盖网格）
        if (typeof updateKnowledgeGrid === 'function') {
            console.log('📊 刷新知识点覆盖网格...');
            updateKnowledgeGrid();
        }
        
        // 刷新堆叠图
        if (typeof updateQuestionStackChart === 'function') {
            console.log('📊 刷新堆叠图...');
            updateQuestionStackChart();
        }
        
        // 刷新知识点覆盖折线图
        if (typeof updateKnowledgeLineChart === 'function') {
            console.log('📊 刷新知识点覆盖折线图...');
            updateKnowledgeLineChart();
        }
        
        // 刷新认知维度甜甜圈图（使用正确的 updateDonutChart + phpAxesConfig）
        if (typeof updateDonutChart === 'function' && typeof phpAxesConfig !== 'undefined' && phpAxesConfig.length > 0) {
            console.log('📊 刷新认知维度甜甜圈图...');
            const currentPivot = phpAxesConfig.find(a => a.isPivot) || phpAxesConfig[0];
            updateDonutChart(currentPivot);
        }
        
        // 刷新形式规范表格和散点图
        if (typeof updateFormatBarChart === 'function') {
            console.log('📊 刷新形式规范表格...');
            updateFormatBarChart();
        }
        if (typeof updateFormatScatterChart === 'function') {
            console.log('📊 刷新形式规范散点图...');
            updateFormatScatterChart();
        }
        
        // 刷新雷达图（会重新计算三维度分数和缺陷列表）
        if (typeof updateRadarChart === 'function') {
            console.log('📊 刷新雷达图（含缺陷重计算）...');
            updateRadarChart();
        }
        
        console.log('✅ 所有视图刷新完成，预览题目ID:', window._previewQuestionIds);
    } catch (e) {
        console.error('刷新视图时出错:', e);
    }
    
    // 恢复原始数据（实际上保留合并后的，因为我们要显示预览）
    // 不恢复，保持预览状态
}

// 清除预览状态
function clearPreview() {
    previewingQuestionId = null;
    
    const previewInfo = document.getElementById('preview-info');
    if (previewInfo) {
        previewInfo.textContent = '';
    }
    
    renderCandidateQuestions();
}

// 清除视图中的预览（恢复原始数据）
function clearViewPreview() {
    previewQuestionForView = null;
    window._previewQuestionIds = [];
    
    // 恢复原始 questionData 并刷新视图
    // 需要重新从文件加载或使用缓存的原始数据
    refreshViewsWithPreview();
    updateEditStatus('已清除预览', '#666');
}

// Accept 选中的题目 - 正式添加到视图数据中
async function acceptSelectedQuestions() {
    if (selectedQuestionsData.length === 0) {
        alert('请先在候选题目列表中至少选择一道题目。');
        return;
    }
    
    console.log('✅ 接受题目：', selectedQuestionsData);
    
    // 将选中的题目转换为视图数据格式，并添加到 acceptedPreviewQuestions
    selectedQuestionsData.forEach(candidate => {
        const converted = convertCandidateToQuestionData(candidate);
        converted.isPreview = false;  // 不再是预览，而是已接受
        converted.isAccepted = true;
        
        // 避免重复添加
        if (!acceptedPreviewQuestions.some(q => q.questionId === converted.questionId)) {
            acceptedPreviewQuestions.push(converted);
        }
    });
    
    // 清除单个预览状态
    previewQuestionForView = null;
    
    // 刷新视图以显示新增的题目
    refreshViewsWithPreview();
    
    updateEditStatus(`✓ 已将 ${selectedQuestionsData.length} 道题目添加到试卷！`, '#4CAF50');
    
    // 尝试保存到后端（可选）
    try {
        const saveResult = await saveAcceptedQuestionsToBackend();
        if (saveResult) {
            console.log('✅ 题目已保存到后端');
        }
    } catch (e) {
        console.warn('保存到后端失败（可稍后手动导出）:', e);
    }
    
    // 清空选中列表
    const acceptedCount = selectedQuestionsData.length;
    selectedQuestionsData = [];
    renderSelectedQuestions();
    renderCandidateQuestions();
    
    alert(`✓ 已成功将 ${acceptedCount} 道题目添加到试卷！\n\n新增题目已在树图与平行集图中显示（以金色高亮）。`);
}

// 将已接受的题目保存到后端
async function saveAcceptedQuestionsToBackend() {
    if (acceptedPreviewQuestions.length === 0) return false;
    
    const currentDataSource = document.getElementById('data-source-dropdown')?.value || 'default';
    
    // 准备要更新的数据
    const newQuestions = acceptedPreviewQuestions.map(q => ({
        questionId: q.questionId.replace('Q_NEW_', 'Q'),  // 移除临时前缀
        knowledgeType: q.knowledgeType,
        bloomGoal: q.bloomGoal,
        difficulty: q.difficulty,
        questionType: q.questionType,
        description: q.description
    }));
    
    try {
        const response = await fetch('/api/add-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dataSource: currentDataSource,
                questions: newQuestions
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('保存结果:', result);
            return true;
        }
    } catch (e) {
        console.error('保存请求失败:', e);
    }
    
    return false;
}

// ==================== Self-Polish 框架：优化输入 Prompt ====================

/**
 * Self-Polish 迭代优化流程：
 * 1. 收集三维度缺陷 + 用户输入
 * 2. 整合成初始 Prompt
 * 3. 迭代润色优化 Prompt（去歧义、明确化、结构化）
 * 4. 输出最优 Prompt 给 API 生成题目
 */

// Self-Polish 迭代次数
const SELF_POLISH_ITERATIONS = 3;

// 构建初始 Prompt（整合缺陷 + 用户输入）
function buildInitialPrompt(defectsSummary, userSuggestions, examStats) {
    let prompt = '';
    
    prompt += `【当前试卷状态】\n`;
    prompt += `- 总题目数：${examStats.totalQuestions || 0}\n`;
    prompt += `- 现有题型：${examStats.questionTypes?.join('、') || '无'}\n`;
    prompt += `- 现有认知层级：${examStats.bloomLevels?.join('、') || '无'}\n`;
    prompt += `- 现有知识类型：${examStats.knowledgeTypes?.join('、') || '无'}\n\n`;
    
    prompt += `【三维度缺陷分析】\n${defectsSummary || '未检出显著缺陷'}\n\n`;
    
    if (userSuggestions) {
        prompt += `【用户额外要求】\n${userSuggestions}\n\n`;
    }
    
    prompt += `【生成目标】\n`;
    prompt += `基于以上缺陷分析，生成 3-6 道新题目以弥补试卷不足。所有输出文本必须使用简体中文。\n`;
    
    return prompt;
}

// Self-Polish 单次润色迭代
function polishPrompt(prompt, iteration) {
    let polishedPrompt = prompt;
    
    if (iteration === 1) {
        polishedPrompt = polishedPrompt
            .replace(/一些/g, '具体的')
            .replace(/可能/g, '需要')
            .replace(/大概/g, '明确地')
            .replace(/等等/g, '');
        
        polishedPrompt += `\n【约束条件】\n`;
        polishedPrompt += `- 每道题目必须完整且可直接使用\n`;
        polishedPrompt += `- 题目必须专业、准确，并符合考试标准\n`;
        polishedPrompt += `- 所有输出文本必须使用简体中文\n`;
    }
    
    if (iteration === 2) {
        polishedPrompt += `- 明确标注每道题目针对的缺陷\n`;
        polishedPrompt += `- 难度等级应合理分布\n`;
        polishedPrompt += `\n【输出格式】\n`;
        polishedPrompt += `每道题目必须包含：id、improved（题目内容）、targetDefect（针对的缺陷）、attributes\n`;
    }
    
    if (iteration === 3) {
        polishedPrompt += `\n【质量校验】\n`;
        polishedPrompt += `- 校验题目中无歧义表述\n`;
        polishedPrompt += `- 校验难度标签准确\n`;
        polishedPrompt += `- 校验知识点覆盖与缺陷对应\n`;
    }
    
    return polishedPrompt;
}

// Self-Polish 完整流程
function selfPolishPrompt(defectsSummary, userSuggestions, examStats) {
    console.log('=== Self-Polish 开始 ===');
    
    // 1. 构建初始 Prompt
    let prompt = buildInitialPrompt(defectsSummary, userSuggestions, examStats);
    console.log(`[迭代 0] 初始 Prompt 长度: ${prompt.length}`);
    
    // 2. 迭代润色优化
    for (let i = 1; i <= SELF_POLISH_ITERATIONS; i++) {
        prompt = polishPrompt(prompt, i);
        console.log(`[迭代 ${i}] 润色后 Prompt 长度: ${prompt.length}`);
    }
    
    console.log('=== Self-Polish 完成 ===');
    console.log('最终 Prompt:\n', prompt);
    
    return prompt;
}

// 生成改进后的题目（调用 AI）
async function generateImprovedQuestions() {
    const textarea = document.getElementById('edit-suggestions');
    const userSuggestions = textarea ? textarea.value.trim() : '';
    
    // 重置数据
    candidateQuestionsData = [];
    selectedQuestionsData = [];
    previewingQuestionId = null;
    
    // 显示加载状态
    updateEditStatus('Self-Polish 优化中…', '#2196F3');
    
    try {
        // 获取所有维度的缺陷汇总
        const defectsSummary = getAllDefectsSummary();
        
        // 构建试卷统计信息（带上每个章节的关键知识点 keyPoints，便于后端按具体知识点命题）
        const chaptersForPrompt = chapterData ? chapterData.map(ch => {
            const coveredKps = chapterKnowledgeMap[ch.id] || [];
            // ch.keyPoints 通常是逗号/顿号分隔的字符串，拆成数组
            const keyPointsRaw = ch.keyPoints || '';
            const keyPointsList = typeof keyPointsRaw === 'string'
                ? keyPointsRaw.split(/[、,，;；/]/).map(s => s.trim()).filter(Boolean)
                : (Array.isArray(keyPointsRaw) ? keyPointsRaw : []);
            // 还没被任何题目覆盖的关键知识点（按名字简单匹配 coveredKps 是否含该名）
            const coveredNames = coveredKps.map(kp => (kp && kp.name) ? kp.name : String(kp));
            const missingKeyPoints = keyPointsList.filter(kp =>
                !coveredNames.some(n => typeof n === 'string' && (n.includes(kp) || kp.includes(n)))
            );
            return {
                id: ch.id,
                name: ch.name,
                description: ch.description || '',
                keyPoints: keyPointsList,
                missingKeyPoints,
                keyPointsCount: ch.keyPointsCount,
                coveredPoints: coveredKps.length
            };
        }) : [];

        // 显式列出"完全未覆盖"和"覆盖严重不足"的章节，便于 AI/Mock 直接使用具体名称命题
        const uncoveredChapters = chaptersForPrompt
            .filter(ch => (ch.coveredPoints || 0) === 0 && (ch.keyPointsCount || 0) > 0);
        const lowCoverageChapters = chaptersForPrompt
            .filter(ch => (ch.keyPointsCount || 0) > 0
                && (ch.coveredPoints || 0) > 0
                && (ch.coveredPoints || 0) < (ch.keyPointsCount || 0) * 0.4);

        const examStats = {
            totalQuestions: questionData ? questionData.length : 0,
            chapters: chaptersForPrompt,
            uncoveredChapters,
            lowCoverageChapters,
            questionTypes: questionData ? [...new Set(questionData.map(q => q.questionType))] : [],
            bloomLevels: questionData ? [...new Set(questionData.map(q => q.bloomGoal))] : [],
            knowledgeTypes: questionData ? [...new Set(questionData.map(q => q.knowledgeType))] : []
        };

        console.log('🎯 待补充章节（无题目）:', uncoveredChapters.map(c => c.name));
        console.log('⚠️ 覆盖不足章节:', lowCoverageChapters.map(c => `${c.name}(${c.coveredPoints}/${c.keyPointsCount})`));
        
        // ========== Self-Polish 流程 ==========
        // 整合缺陷 + 用户输入，迭代优化得到最优 Prompt
        const optimizedPrompt = selfPolishPrompt(defectsSummary, userSuggestions, examStats);
        
        updateEditStatus('正在使用优化后的 Prompt 生成题目…', '#2196F3');
        
        // 构建请求数据（使用优化后的 Prompt）
        const requestData = {
            questions: [],
            userSuggestions: optimizedPrompt,  // 传递优化后的 Prompt
            questionContentMap: questionContentMap,
            defectsSummary: defectsSummary,
            dimensionDefects: dimensionDefects,
            generateNewOnly: true,
            selfPolishApplied: true,  // 标记已应用 Self-Polish
            examStats: examStats
        };
        
        // 调用后端 API
        const response = await fetch('/api/improve-questions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.improvedQuestions) {
            candidateQuestionsData = result.improvedQuestions;
            
            const isMock = result.isMockData;
            const count = candidateQuestionsData.length;
            
            if (isMock) {
                updateEditStatus(`⚠ 模拟数据（${count} 道题）`, '#ff9800');
            } else {
                updateEditStatus(`✓ Self-Polish → ${count} 道题`, '#4CAF50');
            }
            
            // 渲染候选题目列表
            renderCandidateQuestions();
            renderSelectedQuestions();
            
        } else {
            throw new Error(result.error || '题目生成失败');
        }
        
    } catch (error) {
        console.error('生成补充题目时出错：', error);
        updateEditStatus('✗ 生成失败', '#f44336');
        alert('题目生成失败：' + error.message);
    }
}

// 导出选中的题目
function exportImprovedQuestions() {
    const questionsToExport = selectedQuestionsData.length > 0 ? selectedQuestionsData : candidateQuestionsData;
    
    if (!questionsToExport || questionsToExport.length === 0) {
        alert('暂无可导出的题目，请先生成并选择题目。');
        return;
    }
    
    const exportData = {
        exportTime: new Date().toISOString(),
        dataSource: currentDataSource,
        totalQuestions: questionsToExport.length,
        selectedQuestions: questionsToExport
    };
    
    const jsonContent = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `selected_questions_${currentDataSource}_${new Date().toISOString().slice(0,10)}.json`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('题目已导出：', questionsToExport.length, '道');
    updateEditStatus(`✓ 已导出 ${questionsToExport.length} 道题目`, '#4CAF50');
}

// ==================== 导出修正后的题目 ====================

// 导出修正后的题目
function exportCorrections() {
    if (!formatImprovementData || formatImprovementData.length === 0) {
        alert('当前没有可导出的修正数据。');
        return;
    }
    
    // 构建导出数据
    const exportData = {
        exportTime: new Date().toISOString(),
        dataSource: currentDataSource,
        totalCorrections: formatImprovementData.length,
        corrections: formatImprovementData.map(item => ({
            questionId: item.id,
            originalText: item.original,
            errorType: item.errorType,
            issue: item.issue,
            revisedText: item.revised,
            improvement: item.improvement
        }))
    };
    
    // 创建导出文本（JSON格式）
    const jsonContent = JSON.stringify(exportData, null, 2);
    
    // 创建下载链接
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `corrections_${currentDataSource}_${new Date().toISOString().slice(0,10)}.json`;
    
    // 触发下载
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('修正数据导出成功：', exportData.totalCorrections, '条');
}

// ==================== Quality Summary Generation ====================

/**
 * Generate quality summary using LLM based on detected defects
 */
async function generateQualitySummary() {
    const summaryTextarea = document.querySelector('.summary-content textarea');
    const summaryBtn = document.querySelector('.summary-btn');
    
    if (!summaryTextarea || !summaryBtn) {
        console.error('未找到总结相关元素');
        return;
    }
    
    // Show loading state
    const originalBtnText = summaryBtn.textContent;
    summaryBtn.textContent = '生成中…';
    summaryBtn.disabled = true;
    summaryTextarea.placeholder = '正在调用 AI 生成质量总结…';
    
    try {
        // Get all defects summary
        const defectsSummary = getAllDefectsSummary();
        
        // Build exam statistics
        const examStats = {
            totalQuestions: questionData ? questionData.length : 0,
            chapters: chapterData ? chapterData.map(ch => ({
                id: ch.id,
                name: ch.name,
                keyPointsCount: ch.keyPointsCount,
                coveredPoints: (chapterKnowledgeMap[ch.id] || []).length
            })) : [],
            questionTypes: questionData ? [...new Set(questionData.map(q => q.questionType))] : [],
            bloomLevels: questionData ? [...new Set(questionData.map(q => q.bloomGoal))] : [],
            knowledgeTypes: questionData ? [...new Set(questionData.map(q => q.knowledgeType))] : []
        };
        
        // Prepare request data
        const requestData = {
            defectsSummary: defectsSummary,
            dimensionDefects: dimensionDefects,
            examStats: examStats
        };
        
        console.log('正在基于缺陷生成质量总结：', dimensionDefects);
        
        // Call backend API
        const response = await fetch('/api/generate-summary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.summary) {
            summaryTextarea.value = result.summary;
            console.log('质量总结生成成功');
        } else {
            throw new Error(result.error || '总结生成失败');
        }
        
    } catch (error) {
        console.error('生成质量总结时出错：', error);
        
        // Fallback: generate a local summary
        const localSummary = generateLocalSummary();
        summaryTextarea.value = localSummary;
    } finally {
        // Restore button state
        summaryBtn.textContent = originalBtnText;
        summaryBtn.disabled = false;
        summaryTextarea.placeholder = '试卷质量总结…';
    }
}

/**
 * Export quality report as PDF/printable format
 */
function exportQualityReport() {
    const summaryTextarea = document.querySelector('.summary-content textarea');
    const summaryText = summaryTextarea ? summaryTextarea.value : '';
    
    if (!summaryText || summaryText === '试卷质量总结…') {
        alert('请先点击"更新"生成质量总结。');
        return;
    }
    
    // Collect accepted new questions
    const acceptedQuestions = (acceptedPreviewQuestions || []).map((q, idx) => {
        const orig = q.originalCandidate || {};
        return {
            number: idx + 1,
            content: orig.improved || q.description || '',
            explanation: orig.explanation || '',
            chapter: q.chapterName || orig.targetChapter || '-',
            knowledgeType: q.knowledgeType || '-',
            bloomLevel: q.bloomGoal || '-',
            difficulty: q.difficulty || '-',
            questionType: q.questionType || '-'
        };
    });

    // Collect all report data
    const reportData = {
        title: '试卷覆盖度可视化评估报告',
        dataSource: currentDataSource,
        generatedAt: new Date().toLocaleString(),
        summary: summaryText,
        statistics: {
            totalQuestions: questionData ? questionData.length : 0,
            chapters: chapterData ? chapterData.length : 0,
            questionTypes: questionData ? [...new Set(questionData.map(q => q.questionType))].join('、') : '',
            bloomLevels: questionData ? [...new Set(questionData.map(q => q.bloomGoal))].join('、') : ''
        },
        defects: {
            knowledge: dimensionDefects.knowledge || [],
            cognitive: dimensionDefects.cognitive || [],
            format: dimensionDefects.format || []
        },
        acceptedQuestions: acceptedQuestions
    };
    
    // Generate HTML report for printing/PDF
    const reportHTML = generateReportHTML(reportData);
    
    // Open print window
    const printWindow = window.open('', '_blank');
    printWindow.document.write(reportHTML);
    printWindow.document.close();
    
    // Trigger print dialog (user can save as PDF)
    setTimeout(() => {
        printWindow.print();
    }, 500);
    
    console.log('质量报告已导出');
}

/**
 * Generate HTML content for the quality report
 */
function generateReportHTML(data) {
    const knowledgeDefectsHTML = data.defects.knowledge.length > 0 
        ? data.defects.knowledge.map(d => `<li>${d}</li>`).join('') 
        : '<li>未检出问题</li>';
    
    const cognitiveDefectsHTML = data.defects.cognitive.length > 0 
        ? data.defects.cognitive.map(d => `<li>${d}</li>`).join('') 
        : '<li>未检出问题</li>';
    
    const formatDefectsHTML = data.defects.format.length > 0 
        ? data.defects.format.map(d => `<li>${d}</li>`).join('') 
        : '<li>未检出问题</li>';

    const acceptedQuestionsHTML = (data.acceptedQuestions && data.acceptedQuestions.length > 0)
        ? data.acceptedQuestions.map(q => `
            <div class="question-item">
                <div class="question-item-header">
                    <span class="question-num">#${q.number}</span>
                    <span class="question-tag">${cnLabel(q.questionType)}</span>
                    <span class="question-tag">${cnLabel(q.knowledgeType)}</span>
                    <span class="question-tag">${cnLabel(q.bloomLevel)}</span>
                    <span class="question-tag difficulty-${(q.difficulty || '').toLowerCase()}">${cnLabel(q.difficulty)}</span>
                    ${q.chapter !== '-' ? `<span class="question-tag chapter-tag">${q.chapter}</span>` : ''}
                </div>
                <div class="question-item-content">${q.content}</div>
                ${q.explanation ? `<div class="question-item-reason"><strong>出题思路：</strong>${q.explanation}</div>` : ''}
            </div>
        `).join('')
        : '';
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${data.title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            color: #1a237e;
            text-align: center;
            margin-bottom: 10px;
            font-size: 24px;
        }
        .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
            font-size: 12px;
        }
        h2 {
            color: #3949ab;
            border-bottom: 2px solid #3949ab;
            padding-bottom: 5px;
            margin: 25px 0 15px 0;
            font-size: 16px;
        }
        .summary-box {
            background: #f5f7fa;
            border-left: 4px solid #3949ab;
            padding: 15px 20px;
            margin: 15px 0;
            font-style: italic;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin: 15px 0;
        }
        .stat-item {
            background: #fafafa;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid #e0e0e0;
        }
        .stat-label {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
        }
        .stat-value {
            font-size: 18px;
            font-weight: bold;
            color: #1a237e;
        }
        .defect-section {
            margin: 15px 0;
        }
        .defect-title {
            font-weight: 600;
            color: #455a64;
            margin-bottom: 8px;
        }
        .defect-list {
            padding-left: 20px;
            font-size: 13px;
        }
        .defect-list li {
            margin: 5px 0;
        }
        .footer {
            margin-top: 40px;
            text-align: center;
            color: #999;
            font-size: 11px;
            border-top: 1px solid #e0e0e0;
            padding-top: 15px;
        }
        .question-item {
            background: #f8faf8;
            border: 1px solid #c8e6c9;
            border-left: 4px solid #4caf50;
            border-radius: 6px;
            padding: 14px 16px;
            margin: 12px 0;
        }
        .question-item-header {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
        }
        .question-num {
            font-weight: 700;
            color: #2e7d32;
            font-size: 14px;
            margin-right: 4px;
        }
        .question-tag {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 500;
            background: #e8eaf6;
            color: #3949ab;
        }
        .question-tag.chapter-tag {
            background: #fff3e0;
            color: #e65100;
        }
        .question-tag.difficulty-easy { background: #e8f5e9; color: #2e7d32; }
        .question-tag.difficulty-medium { background: #fff8e1; color: #f57f17; }
        .question-tag.difficulty-hard { background: #fbe9e7; color: #c62828; }
        .question-item-content {
            font-size: 13px;
            line-height: 1.7;
            color: #333;
            white-space: pre-wrap;
        }
        .question-item-reason {
            margin-top: 8px;
            font-size: 11px;
            color: #666;
            font-style: italic;
            border-top: 1px dashed #ddd;
            padding-top: 6px;
        }
        .no-questions-note {
            color: #999;
            font-style: italic;
            text-align: center;
            padding: 15px;
        }
        @media print {
            body { padding: 20px; }
            .no-print { display: none; }
            .question-item { break-inside: avoid; }
        }
    </style>
</head>
<body>
    <h1>${data.title}</h1>
    <div class="subtitle">
        数据源：${data.dataSource} ｜ 生成时间：${data.generatedAt}
    </div>
    
    <h2>总体摘要</h2>
    <div class="summary-box">
        ${data.summary}
    </div>
    
    <h2>试卷统计</h2>
    <div class="stats-grid">
        <div class="stat-item">
            <div class="stat-label">题目总数</div>
            <div class="stat-value">${data.statistics.totalQuestions}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">覆盖章节数</div>
            <div class="stat-value">${data.statistics.chapters}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">题型分布</div>
            <div class="stat-value" style="font-size: 12px;">${data.statistics.questionTypes || '无'}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">布鲁姆层级</div>
            <div class="stat-value" style="font-size: 12px;">${data.statistics.bloomLevels || '无'}</div>
        </div>
    </div>
    
    <h2>多维度缺陷分析</h2>
    
    <div class="defect-section">
        <div class="defect-title">📚 知识覆盖问题（${data.defects.knowledge.length}）</div>
        <ul class="defect-list">${knowledgeDefectsHTML}</ul>
    </div>
    
    <div class="defect-section">
        <div class="defect-title">🧠 认知结构问题（${data.defects.cognitive.length}）</div>
        <ul class="defect-list">${cognitiveDefectsHTML}</ul>
    </div>
    
    <div class="defect-section">
        <div class="defect-title">📝 形式与篇幅问题（${data.defects.format.length}）</div>
        <ul class="defect-list">${formatDefectsHTML}</ul>
    </div>
    
    ${data.acceptedQuestions && data.acceptedQuestions.length > 0 ? `
    <h2>已采纳的补充题目（${data.acceptedQuestions.length}）</h2>
    <p style="font-size: 12px; color: #666; margin-bottom: 10px;">
        以下题目由 Self-Polish 框架针对上述缺陷生成并已纳入试卷。
    </p>
    ${acceptedQuestionsHTML}
    ` : ''}
    
    <div class="footer">
        试卷覆盖度可视化评估系统 ｜ 多维度可视化分析平台
    </div>
</body>
</html>
    `;
}

/**
 * Generate a local summary when API is unavailable
 */
function generateLocalSummary() {
    const knowledgeDefects = dimensionDefects.knowledge || [];
    const cognitiveDefects = dimensionDefects.cognitive || [];
    const formatDefects = dimensionDefects.format || [];
    
    const totalDefects = knowledgeDefects.length + cognitiveDefects.length + formatDefects.length;
    
    if (totalDefects === 0) {
        return "本试卷在三大评估维度上覆盖较为均衡，未检测到关键结构性缺陷。可对题目表述进行细微优化，以进一步增强清晰度和认知对齐度。";
    }
    
    // Find the most critical dimension
    let criticalDimension = '知识覆盖';
    let criticalCount = knowledgeDefects.length;
    
    if (cognitiveDefects.length > criticalCount) {
        criticalDimension = '认知结构';
        criticalCount = cognitiveDefects.length;
    }
    if (formatDefects.length > criticalCount) {
        criticalDimension = '形式与篇幅';
        criticalCount = formatDefects.length;
    }
    
    return `关键问题：${criticalDimension} 维度共有 ${criticalCount} 处缺陷，需优先处理。` +
           `全卷共检出 ${totalDefects} 处问题，分布于三个维度。` +
           `建议策略：先聚焦 ${criticalDimension} 维度的缺口，` +
           `相关改动通常可同时改善认知对齐问题。` +
           `后续应重点平衡题目分布，确保知识点的全面覆盖。`;
}

