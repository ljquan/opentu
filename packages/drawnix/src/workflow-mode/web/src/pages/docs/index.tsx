import { ArrowUpRight, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

const guides = [
    {
        id: "start", title: "快速开始", subtitle: "先完成一次生成，再组织你的创作流程。", to: "/config", action: "打开配置",
        steps: [
            "打开「配置」，在渠道设置中填写服务商提供的接口地址和 API Key，添加需要的模型并保存。已有 OpenTu 分组时，可在本地渠道编辑器中选择「从 OpenTu 自动填入」，核对后保存。",
            "在偏好设置中选择对应能力的默认模型，或在生成时手动选择。模型名称出现在列表中，并不代表当前账号已开通该模型。",
            "进入「生图工作台」，输入一段具体描述，选择模型和参数；第一次先生成一张，确认配置可用。",
            "查看生成结果，下载到本机，或加入「我的资产」。需要继续组合创作时，再进入「我的画布」。",
        ],
        note: "生成会调用所选渠道。费用、额度、速度和模型能力取决于服务商及你的账号。",
    },
    {
        id: "canvas", title: "我的画布", subtitle: "用节点和连线串起文字、参考素材与生成结果。", to: "/canvas", action: "打开我的画布",
        steps: [
            "新建画布，双击画布名称重命名。使用底部工具栏添加文本、图片、视频、音频或生成配置节点，也可以上传素材。",
            "选中需要生成的节点，在输入面板中填写要求。点击「参考内容」下的加号，从画布选择参考节点；添加后可在参考区检查或断开连接。",
            "需要复用一套流程时，将文字或素材连到「生成配置」节点，选择生成类型、模型和参数，通过「组装提示词」整理要求，再点击「开始生成」。",
            "输入 @ 可选择当前可引用的参考内容。双击文字节点编辑内容；选中多个节点后可以分组，便于整体移动和整理。",
            "生成后继续调整提示词、复用结果，或通过画布菜单导出当前画布。",
        ],
        note: "参考图片、视频和音频是否可用，以及允许的数量和格式，以所选模型的输入能力为准。连接素材不代表所有模型都能接收。",
    },
    {
        id: "image", title: "生图工作台", subtitle: "适合已有明确想法、需要集中比较图片结果的任务。", to: "/image", action: "打开生图工作台",
        steps: [
            "写出主体、场景、构图、风格和需要保留的细节。需要参考图时，从剪贴板、上传入口或「我的资产」中添加。",
            "选择图片模型，按页面提供的选项设置尺寸、比例和数量。模型不同，可用参数也会变化。",
            "点击生成，在结果区查看图片。需要长期保留的结果请下载，或保存到「我的资产」。",
            "点击左侧历史记录可复用输入和查看结果；历史图片还可以拖入参考区，用于下一次创作。",
        ],
        example: "一只橙红色陶瓷杯放在浅木色桌面上，背景为奶油白墙面，左侧自然窗光，近景产品摄影，保留陶瓷细腻质感，不添加文字。",
    },
    {
        id: "video", title: "视频创作台", subtitle: "描述动作、镜头和节奏，让静态想法成为连续画面。", to: "/video", action: "打开视频创作台",
        steps: [
            "输入视频提示词，说明主体如何运动、镜头如何移动，以及场景和光线如何变化。",
            "选择视频模型后，按可用入口添加参考图片、视频或音频。首尾帧与参考模式的用途不同，请核对素材顺序和模型要求。",
            "设置模型支持的时长、分辨率和比例后开始生成。视频任务可能需要等待，成功后可在右侧播放并下载。",
            "左侧历史记录可预览成功视频；点击记录查看完整结果。可将成功记录保存到资产，或拖入支持参考视频的输入区域。",
        ],
        example: "镜头缓慢推近桌上的陶瓷杯，杯口升起轻薄蒸汽，背景保持稳定，晨间柔和侧光，动作自然连贯，不出现文字。",
        note: "只接受公开视频地址的模型，可能无法使用浏览器本地的历史视频作为参考。请以页面提示为准。",
    },
    {
        id: "reuse", title: "提示词库与我的资产", subtitle: "把有效的描述和满意的素材留给下一次创作。", to: "/assets", action: "打开我的资产",
        steps: [
            "在「提示词库」中搜索、按标签或来源筛选，打开详情查看内容；在工作台使用「查看提示词库」选取需要的描述。",
            "将满意的生成结果加入「我的资产」，为素材整理标题和标签，方便后续查找。",
            "在画布左侧切换到资产面板，或在工作台打开「查看我的资产」，选择素材用于当前创作。",
        ],
        note: "资产库便于复用；同一浏览器内保存的资产不是独立备份，重要媒体仍建议下载到本机。",
    },
    {
        id: "batch", title: "文档批量生成", subtitle: "从表格或 PDF 整理多条生图任务，核对后再集中提交。", to: "/batch-generation", action: "打开批量生成",
        steps: [
            "新建批次，导入 Excel 或 PDF。可先下载 Excel 模板，按一行一个任务填写提示词，参考图可以留空。导入本身不会提交生图。",
            "逐行检查提示词、参考图及来源。外链图片需要手动加载；PDF 可查看原页和手动裁图，可选的识别操作需要另行确认。",
            "选择可用图片模型、默认参数和每行数量，将核对完成的行标记为可生成，再勾选并确认生成。",
            "通过本轮进度查看排队、处理中、成功、失败或待确认项。暂停只阻止后续提交，刷新后需点击继续恢复剩余队列。",
            "在当前轮次或历史中选择结果下载 ZIP，也可导出失败清单，或将单张结果保存到资产。",
        ],
        note: "批量生成目前只支持页面列出的 OpenTu 图片模型，不支持自定义渠道或脚本模型。PDF 自动整理仍需人工核对；关闭浏览器后不会继续提交新任务。",
    },
    {
        id: "storage", title: "保存、导出与任务恢复", subtitle: "保留创作成果，也保留尚未确认的任务线索。",
        steps: [
            "画布、素材和生成记录主要保存在当前浏览器本地。同一设备的其他浏览器、不同域名或端口，不能默认读取这些数据。",
            "重要画布通过画布菜单导出，图片和视频通过结果区下载，批量结果通过 ZIP 导出。更换设备或清理网站数据前，先确认导出文件已保存。",
            "刷新后，具备查询条件的任务会尝试查询原结果；恢复依赖原账号、渠道、凭据和任务标识，不能保证所有模型都能恢复。",
            "看到「结果待确认」时，先查看状态和错误提示。网络中断不等于供应商没有受理，重新生成是一次新请求，可能再次计费。",
        ],
        note: "API Key 属于账号凭据，请勿分享给他人。配置导出可能包含本地渠道密钥，与普通作品导出应分别保管。",
    },
];

const questions = [
    ["模型列表为空或提示未配置", "先检查渠道是否启用、模型是否添加并保存，再为当前生成类型选择模型。图片、视频、文本和音频使用各自的模型选择。"],
    ["出现鉴权失败、限流或接口不存在", "鉴权失败时核对 API Key、账号权限和额度；限流时等待后再试；接口不存在时检查渠道地址、协议和模型配置。请保留具体错误，便于排查。"],
    ["记录显示成功，但图片或视频加载不了", "可能是本地媒体缺失、远程地址失效或资源请求失败。先检查是否已有下载或资产副本，再确认资源是否可访问；加载失败本身不代表需要重新生成。"],
    ["Agent 显示未连接，还能正常使用吗？", "可以，画布和工作台生成不要求连接 Agent。需要 Agent 协助时，在其连接设置中完成本地服务连接；未连接时不能使用依赖 Agent 的对话和操作。"],
];

const shortcuts = [
    ["滚轮 / 底部缩放控件", "缩放画布"],
    ["空格 + 拖动", "临时移动画布"],
    ["Ctrl / Cmd + C、V", "复制、粘贴选中节点"],
    ["Ctrl / Cmd + Z", "撤销"],
    ["Ctrl / Cmd + Shift + Z", "重做"],
    ["Ctrl / Cmd + G", "将选中节点分组"],
    ["Ctrl / Cmd + Shift + G", "取消分组"],
    ["Delete / Backspace", "删除选中节点"],
];

export default function DocsPage() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const navigation = [...guides, { id: "shortcuts", title: "快捷操作" }, { id: "faq", title: "常见问题" }];
    return (
        <main className="h-full min-h-0 overflow-y-auto" style={{ background: theme.node.panel, color: theme.node.text }} aria-label="OpenTu 使用文档">
            <div className="mx-auto max-w-6xl px-5 py-8 sm:px-10 sm:py-12">
                <header className="border-b pb-8" style={{ borderColor: theme.node.stroke }}>
                    <div className="mb-5 flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4" aria-hidden="true" />OpenTu / 使用指南</div>
                    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">从第一次生成，到完整创作流程</h1>
                    <p className="mt-4 max-w-2xl text-base leading-7" style={{ color: theme.node.muted }}>这份文档介绍 OpenTu 工作流模式的日常用法。先配置模型，再选择画布或工作台开始创作；参考素材、提示词和生成结果可以在同一个工作区中复用。</p>
                </header>
                <div className="grid gap-10 pt-8 lg:grid-cols-[180px_minmax(0,1fr)]">
                    <aside>
                        <nav aria-label="文档目录" className="sticky top-6 grid gap-1 text-sm">
                            <p className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>本页目录</p>
                            {navigation.map((section, index) => (
                                <a key={section.id} href={`#${section.id}`} className="flex gap-3 rounded px-2 py-2 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 dark:hover:bg-white/10">
                                    <span className="font-mono text-xs" style={{ color: theme.node.muted }}>{String(index + 1).padStart(2, "0")}</span>{section.title}
                                </a>
                            ))}
                        </nav>
                    </aside>
                    <article className="min-w-0 space-y-12 pb-12">
                        {guides.map((guide, index) => (
                            <section key={guide.id} id={guide.id} aria-labelledby={`${guide.id}-heading`} className="scroll-mt-6 border-b pb-10" style={{ borderColor: theme.node.stroke }}>
                                <div className="mb-2 text-xs font-medium" style={{ color: theme.node.muted }}>指南 {String(index + 1).padStart(2, "0")}</div>
                                <h2 id={`${guide.id}-heading`} className="text-2xl font-semibold">{guide.title}</h2>
                                <p className="mb-5 mt-3 leading-7" style={{ color: theme.node.muted }}>{guide.subtitle}</p>
                                <ol className="list-decimal space-y-3 pl-5 text-sm leading-7">
                                    {guide.steps.map((step) => <li key={step} className="pl-1">{step}</li>)}
                                </ol>
                                {guide.example ? <div className="mt-5 rounded-lg border p-4" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}><h3 className="mb-2 text-xs font-semibold">试试这段提示词</h3><p className="select-text text-sm leading-7">{guide.example}</p></div> : null}
                                {guide.note ? <p className="mt-5 border-l-2 pl-4 text-sm leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{guide.note}</p> : null}
                                {guide.to ? <Link to={guide.to} className="mt-5 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4">{guide.action}<ArrowUpRight className="size-4" aria-hidden="true" /></Link> : null}
                                {guide.id === "reuse" ? <Link to="/prompts" className="ml-5 inline-flex text-sm font-medium underline underline-offset-4">打开提示词库</Link> : null}
                            </section>
                        ))}
                        <section id="shortcuts" aria-labelledby="shortcuts-heading" className="scroll-mt-6">
                            <h2 id="shortcuts-heading" className="text-2xl font-semibold">快捷操作</h2>
                            <p className="my-4 text-sm leading-6" style={{ color: theme.node.muted }}>在画布中使用。输入文字时请以编辑器和输入法的操作为准；也可点击画布右上角的键盘图标查看快捷键。</p>
                            <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><caption className="sr-only">画布快捷键与作用</caption><thead><tr className="border-b" style={{ borderColor: theme.node.stroke }}><th scope="col" className="py-3 pr-5">操作</th><th scope="col" className="py-3">作用</th></tr></thead><tbody>{shortcuts.map(([key, action]) => <tr key={key} className="border-b" style={{ borderColor: theme.node.stroke }}><td className="py-3 pr-5 font-mono text-xs">{key}</td><td className="py-3">{action}</td></tr>)}</tbody></table></div>
                        </section>
                        <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-6">
                            <h2 id="faq-heading" className="text-2xl font-semibold">常见问题</h2>
                            <dl className="mt-6 space-y-7">{questions.map(([question, answer]) => <div key={question}><dt className="text-base font-semibold">{question}</dt><dd className="mt-2 text-sm leading-7" style={{ color: theme.node.muted }}>{answer}</dd></div>)}</dl>
                        </section>
                        <footer className="border-t pt-5 text-xs leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>本文面向 OpenTu 工作流模式。模型能力和参数以当前界面为准，供应商实际响应可能不同。</footer>
                    </article>
                </div>
            </div>
        </main>
    );
}
