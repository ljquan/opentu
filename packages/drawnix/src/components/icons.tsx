import React from 'react';

export const createIcon = (svg: React.ReactNode) => {
  return svg;
};

export const HandIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M7 11.5V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v7.5" />
    <path d="M11 10.5V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v7.5" />
    <path d="M15 11.5V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v7.5" />
    <path d="M19 13.5V9a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v5.5a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v-2a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v3.5" />
  </svg>
);

export const SelectionIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <path d="m13 13 6 6" />
  </svg>
);

export const MindIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M9 12h3c1 0 1-1 1-1V7c0-1 1-1 2-1h1" />
    <path d="M9 12h3c1 0 1 1 1 1v5c0 1 1 1 2 1h1" />
  </svg>
);

export const FolderIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

export const ToolboxIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M14.5 7V5a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v2" />
    <rect width="20" height="13" x="2" y="7" rx="2" />
    <path d="M2 13h20" />
    <path d="M6 13v0" />
    <path d="M18 13v0" />
  </svg>
);

export const TaskIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M11 6h9" />
    <path d="M11 12h9" />
    <path d="M11 18h9" />
    <path d="m3 7 2 2 4-4" />
    <path d="m3 19 2 2 4-4" />
  </svg>
);

export const ImageInspectionIcon: React.FC<
  React.SVGProps<SVGSVGElement> & { size?: number }
> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <circle cx="7.5" cy="8.5" r="1.25" />
    <path d="m5 14 3.25-3 2.3 2 2.1-1.8L16 14" />
    <circle cx="16.5" cy="16.5" r="4" />
    <path d="m19.4 19.4 2.1 2.1" />
    <path d="m14.9 16.5 1.05 1.05 2.15-2.25" />
  </svg>
);

export const ShapeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <rect x="3" y="3" width="10" height="10" rx="2" />
    <circle cx="15" cy="15" r="6" />
  </svg>
);

export const TextIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="12" y1="4" x2="12" y2="20" />
    <line x1="9" y1="20" x2="15" y2="20" />
  </svg>
);

export const EraseIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.9-9.9c1-1 2.5-1 3.4 0l4.4 4.4c1 1 1 2.5 0 3.4L10.5 21z" />
    <path d="m11 7 4 4" />
    <path d="m5 19 3 2" />
    <path d="M13 19h7" />
  </svg>
);

export const StraightArrowLineIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export const RectangleIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24"
    width={size}
    height={size}
    {...props}
  >
    <path
      d="M3 3h18v18H3z"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
    ></path>
  </svg>
);

export const TerminalIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 16 16"
    width={size}
    height={size}
    {...props}
  >
    <g id="terminal" stroke="none" fill="currentColor">
      <path d="M11,3 C13.7614237,3 16,5.23857625 16,8 C16,10.7614237 13.7614237,13 11,13 L5,13 C2.23857625,13 0,10.7614237 0,8 C0,5.23857625 2.23857625,3 5,3 L11,3 Z M11,4.2 L5,4.2 C2.90131795,4.2 1.2,5.90131795 1.2,8 C1.2,10.0330982 2.79664702,11.6932796 4.8044525,11.7950555 L5,11.8 L11,11.8 C13.098682,11.8 14.8,10.098682 14.8,8 C14.8,5.96690176 13.203353,4.30672042 11.1955475,4.20494454 L11,4.2 Z" />
    </g>
  </svg>
);

export const EllipseIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 16 16" 
    version="1.1"
    width={size}
    height={size}
    {...props}
  >
    <g id="ellipse" stroke="none" fill="currentColor">
      <path d="M8,1 C11.8659932,1 15,4.13400675 15,8 C15,11.8659932 11.8659932,15 8,15 C4.13400675,15 1,11.8659932 1,8 C1,4.13400675 4.13400675,1 8,1 Z M8,2.2 C4.79674845,2.2 2.2,4.79674845 2.2,8 C2.2,11.2032515 4.79674845,13.8 8,13.8 C11.2032515,13.8 13.8,11.2032515 13.8,8 C13.8,4.79674845 11.2032515,2.2 8,2.2 Z" />
    </g>
  </svg>
);

export const TriangleIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" version="1.1" width={size} height={size} {...props}>
    <g id="triangle" stroke="none" fill="currentColor">
      <path d="M8.23125547,1.21366135 C8.3114266,1.25857939 8.37766784,1.32472334 8.42270367,1.40482837 L15.6471754,14.2549655 C15.7825042,14.4956743 15.6970768,14.800513 15.456368,14.9358418 C15.3815505,14.977905 15.2971646,15 15.2113335,15 L0.787227066,15 C0.511084691,15 0.287227066,14.7761424 0.287227066,14.5 C0.287227066,14.414418 0.309194147,14.3302684 0.351025556,14.2556064 L7.55066033,1.40546924 C7.6856352,1.1645618 7.99034802,1.07868648 8.23125547,1.21366135 Z M7.98695902,3.07926294 L1.98095902,13.7992629 L14.014959,13.7992629 L7.98695902,3.07926294 Z" />
    </g>
  </svg>
);

export const DiamondIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" version="1.1" width={size} height={size} {...props}>
    <g stroke="none" fill="currentColor">
      <path
        d="M13.7636471,2.6449804 C13.7716713,2.69552516 13.7718878,2.74700226 13.7642892,2.79761274 L12.3875778,11.9671885 C12.3550099,12.1841069 12.184864,12.3544698 11.9679874,12.3873141 L2.78433018,13.7781116 C2.511301,13.8194599 2.25644773,13.6316454 2.21509947,13.3586162 C2.20737253,13.307594 2.20759072,13.2556831 2.21574631,13.2047277 L3.67471119,4.08923146 C3.70888725,3.87570215 3.87646006,3.70834166 4.09003253,3.67443635 L13.1914362,2.22955927 C13.4641633,2.18626298 13.7203508,2.37225335 13.7636471,2.6449804 Z M12.4355704,3.5645263 L4.77957044,4.7795263 L3.55157044,12.4485263 L11.2775704,11.2775263 L12.4355704,3.5645263 Z"
        transform="translate(7.989647, 8.003560) rotate(-315.000000) translate(-7.989647, -8.003560) "
      />
    </g>
  </svg>
);

export const ParallelogramIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" version="1.1" width={size} height={size} {...props}>
    <g stroke="none" fill="currentColor">
      <path d="M15.3062871,3.5 C15.5824294,3.5 15.8062871,3.72385763 15.8062871,4 C15.8062871,4.05374105 15.7976231,4.10713065 15.7806287,4.15811388 L13.113962,12.1581139 C13.045905,12.362285 12.8548356,12.5 12.6396204,12.5 L0.693712943,12.5 C0.417570568,12.5 0.193712943,12.2761424 0.193712943,12 C0.193712943,11.946259 0.202376883,11.8928694 0.219371294,11.8418861 L2.88603796,3.84188612 C2.95409498,3.63771505 3.14516441,3.5 3.36037961,3.5 L15.3062871,3.5 Z M14.335,4.7 L3.864,4.7 L1.664,11.3 L12.134,11.3 L14.335,4.7 Z" />
    </g>
  </svg>
);

export const RoundRectangleIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" version="1.1" width={size} height={size} {...props}>
    <g stroke="none" fill="currentColor">
      <path d="M11,3 C13.7614237,3 16,5.23857625 16,8 C16,10.7614237 13.7614237,13 11,13 L5,13 C2.23857625,13 0,10.7614237 0,8 C0,5.23857625 2.23857625,3 5,3 L11,3 Z M11,4.2 L5,4.2 C2.90131795,4.2 1.2,5.90131795 1.2,8 C1.2,10.0330982 2.79664702,11.6932796 4.8044525,11.7950555 L5,11.8 L11,11.8 C13.098682,11.8 14.8,10.098682 14.8,8 C14.8,5.96690176 13.203353,4.30672042 11.1955475,4.20494454 L11,4.2 Z" />
    </g>
  </svg>
);

export const StraightArrowIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" version="1.1" width={size} height={size} {...props}>
    <g stroke="none" fill="currentColor">
      <path
        d="M8.55595221,-1.5261864 C8.88741773,-1.5261864 9.15621426,-1.25765205 9.15653772,-0.926186684 L9.16739175,10.3828136 L10.9946787,10.3836977 C11.2708211,10.3836977 11.4946787,10.6075553 11.4946787,10.8836977 C11.4946787,10.9607525 11.4768694,11.0367648 11.4426413,11.1058002 L8.8378495,16.3594519 C8.7642512,16.5078936 8.58425218,16.5685662 8.43581043,16.4949679 C8.37895485,16.4667786 8.33250284,16.4212859 8.30313336,16.3650308 L5.56226325,11.1150985 C5.43446412,10.8703088 5.52930372,10.5682659 5.77409341,10.4404667 C5.84552557,10.4031736 5.92491301,10.3836977 6.0054942,10.3836977 L7.96739175,10.3828136 L7.95653772,-0.926186684 C7.95621467,-1.25723416 8.22431979,-1.52586306 8.55536727,-1.52618611 Z"
        transform="translate(8.500035, 7.500035) rotate(-135.000000) translate(-8.500035, -7.500035) "
      />
    </g>
  </svg>
);

export const ElbowArrowIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" version="1.1" width={size} height={size} {...props}>
    <g stroke="none" fill="currentColor">
      <path d="M10.0153197,2.75391207 C10.0923746,2.75391207 10.1683869,2.77172133 10.2374222,2.80594949 L15.4910739,5.41074126 C15.6395156,5.48433956 15.7001882,5.66433859 15.6265899,5.81278033 C15.5984006,5.86963592 15.5529079,5.91608792 15.4966529,5.9454574 L10.2467205,8.68632752 C10.0019308,8.81412664 9.69988791,8.71928704 9.57208878,8.47449735 C9.53479568,8.40306519 9.51531974,8.32367776 9.51531974,8.24309656 L9.51458753,6.62591207 L6.16858753,6.62651279 L6.16914066,12.0061269 C6.16914066,12.3043606 5.95155104,12.5517736 5.66646377,12.5982739 L5.56914066,12.6061269 L0.534587532,12.6061269 C0.203216682,12.6061269 -0.0654124678,12.3374977 -0.0654124678,12.0061269 C-0.0654124678,11.674756 0.203216682,11.4061269 0.534587532,11.4061269 L4.96858753,11.4055128 L4.96914066,6.02651279 C4.96914066,5.72827903 5.18673027,5.48086604 5.47181754,5.43436578 L5.56914066,5.42651279 L9.51458753,5.42591207 L9.51531974,3.25391207 C9.51531974,2.9777697 9.73917736,2.75391207 10.0153197,2.75391207 Z" />
    </g>
  </svg>
);

export const CurveArrowIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" version="1.1" width={size} height={size} {...props}>
    <g stroke="none" fill="currentColor">
      <path d="M10.0153197,2.75391207 C10.0923746,2.75391207 10.1683869,2.77172133 10.2374222,2.80594949 L15.4910739,5.41074126 C15.6395156,5.48433956 15.7001882,5.66433859 15.6265899,5.81278033 C15.5984006,5.86963592 15.5529079,5.91608792 15.4966529,5.9454574 L10.2467205,8.68632752 C10.0019308,8.81412664 9.69988791,8.71928704 9.57208878,8.47449735 C9.53479568,8.40306519 9.51531974,8.32367776 9.51531974,8.24309656 L9.51423005,6.39035523 C5.97984781,6.85936966 3.21691607,9.08498364 1.18879108,13.1285821 C1.04022695,13.4247836 0.679673152,13.5444674 0.383471635,13.3959033 C0.0872701176,13.2473391 -0.0324136308,12.8867853 0.116150501,12.5905838 C2.34388813,8.14900524 5.48945543,5.65776043 9.51468497,5.18078677 L9.51531974,3.25391207 C9.51531974,2.9777697 9.73917736,2.75391207 10.0153197,2.75391207 Z" />
    </g>
  </svg>
);

export const MenuIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width={size}
    height={size}
    {...props}
  >
    <g strokeWidth="1.5">
      <path stroke="none" d="M0 0h24v24H0z"></path>
      <line x1="4" y1="6" x2="20" y2="6"></line>
      <line x1="4" y1="12" x2="20" y2="12"></line>
      <line x1="4" y1="18" x2="20" y2="18"></line>
    </g>
  </svg>
);

export const GithubIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 20, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={size} height={size} {...props}>
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      d="M7.5 15.833c-3.583 1.167-3.583-2.083-5-2.5m10 4.167v-2.917c0-.833.083-1.166-.417-1.666 2.334-.25 4.584-1.167 4.584-5a3.833 3.833 0 0 0-1.084-2.667 3.5 3.5 0 0 0-.083-2.667s-.917-.25-2.917 1.084a10.25 10.25 0 0 0-5.166 0C5.417 2.333 4.5 2.583 4.5 2.583a3.5 3.5 0 0 0-.083 2.667 3.833 3.833 0 0 0-1.084 2.667c0 3.833 2.25 4.75 4.584 5-.5.5-.5 1-.417 1.666V17.5"
      strokeWidth="1.25"
    ></path>
  </svg>
);

// AI 图片图标
export const AIImageIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <rect width="18" height="18" x="3" y="3" rx="3" ry="3" stroke="#E91E63" />
    <circle cx="8.5" cy="8.5" r="1.5" stroke="#E91E63" />
     <path d="m21 15-5-5a2 2 0 0 0-3 0l-9 10" stroke="#E91E63" />
  </svg>
);

// AI 视频图标
export const AIVideoIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11" stroke="#FF9800" />
    <rect x="2" y="6" width="14" height="12" rx="3" stroke="#FF9800" />
  </svg>
);

export const ExportImageIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24"
    width={size}
    height={size}
    {...props}
  >
    <g
      strokeWidth="1.25"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      <path stroke="none" d="M0 0h24v24H0z"></path>
      <path d="M15 8h.01"></path>
      <path d="M12 20h-5a3 3 0 0 1 -3 -3v-10a3 3 0 0 1 3 -3h10a3 3 0 0 1 3 3v5"></path>
      <path d="M4 15l4 -4c.928 -.893 2.072 -.893 3 0l4 4"></path>
      <path d="M14 14l1 -1c.617 -.593 1.328 -.793 2.009 -.598"></path>
      <path d="M19 16v6"></path>
      <path d="M22 19l-3 3l-3 -3"></path>
    </g>
  </svg>
);

export const ZoomOutIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    {...props}
  >
    <g id="zoom-out" stroke="none" fill="currentColor" strokeWidth="1">
      <path
        fillRule="nonzero"
        d="M6.85,2.73225886e-13 C10.6331505,2.73225886e-13 13.7,3.06684946 13.7,6.85 C13.7,8.54194045 13.0865836,10.0906098 12.0700142,11.2857448 L15.4201976,14.5717081 C15.6567367,14.8037768 15.6603607,15.1836585 15.4282919,15.4201976 C15.1962232,15.6567367 14.8163415,15.6603607 14.5798024,15.4282919 L14.5798024,15.4282919 L11.2163456,12.128262 C10.0309427,13.1099691 8.50937591,13.7 6.85,13.7 C3.06684946,13.7 4.58522109e-14,10.6331505 4.58522109e-14,6.85 C4.58522109e-14,3.06684946 3.06684946,2.73225886e-13 6.85,2.73225886e-13 Z M6.85,1.2 C3.72959116,1.2 1.2,3.72959116 1.2,6.85 C1.2,9.97040884 3.72959116,12.5 6.85,12.5 C8.31753357,12.5 9.65438791,11.9404957 10.6588859,11.0231643 C10.6855412,10.9625408 10.7245275,10.9050898 10.7743982,10.8542584 C10.8288931,10.7987137 10.8915387,10.7560124 10.9585649,10.7261903 C11.9144009,9.71595758 12.5,8.35136579 12.5,6.85 C12.5,3.72959116 9.97040884,1.2 6.85,1.2 Z M4.6,6.2 L9.12944565,6.2 C9.4608165,6.2 9.72944565,6.46862915 9.72944565,6.8 C9.72944565,7.09823376 9.51185604,7.34564675 9.22676876,7.39214701 L9.12944565,7.4 L4.6,7.4 C4.26862915,7.4 4,7.13137085 4,6.8 C4,6.50176624 4.21758961,6.25435325 4.50267688,6.20785299 L4.6,6.2 L9.12944565,6.2 Z"
      ></path>
    </g>
  </svg>
);

export const ZoomInIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    {...props}
  >
    <g id="zoom-in" stroke="none" fill="currentColor" strokeWidth="1">
      <path
        fillRule="nonzero"
        d="M6.85,-1.81188398e-13 C10.6331505,-1.81188398e-13 13.7,3.06684946 13.7,6.85 C13.7,8.54194045 13.0865836,10.0906098 12.0700142,11.2857448 L15.4201976,14.5717081 C15.6567367,14.8037768 15.6603607,15.1836585 15.4282919,15.4201976 C15.1962232,15.6567367 14.8163415,15.6603607 14.5798024,15.4282919 L14.5798024,15.4282919 L11.2163456,12.128262 C10.0309427,13.1099691 8.50937591,13.7 6.85,13.7 C3.06684946,13.7 4.61852778e-14,10.6331505 4.61852778e-14,6.85 C4.61852778e-14,3.06684946 3.06684946,-1.81188398e-13 6.85,-1.81188398e-13 Z M6.85,1.2 C3.72959116,1.2 1.2,3.72959116 1.2,6.85 C1.2,9.97040884 3.72959116,12.5 6.85,12.5 C8.31753357,12.5 9.65438791,11.9404957 10.6588859,11.0231643 C10.6855412,10.9625408 10.7245275,10.9050898 10.7743982,10.8542584 C10.8288931,10.7987137 10.8915387,10.7560124 10.9585649,10.7261903 C11.9144009,9.71595758 12.5,8.35136579 12.5,6.85 C12.5,3.72959116 9.97040884,1.2 6.85,1.2 Z M6.86472282,3.93527718 C7.16295659,3.93527718 7.41036958,4.15286679 7.45686984,4.43795406 L7.46472282,4.53527718 L7.464,6.19927718 L9.12944565,6.2 C9.42767941,6.2 9.6750924,6.41758961 9.72159266,6.70267688 L9.72944565,6.8 C9.72944565,7.09823376 9.51185604,7.34564675 9.22676876,7.39214701 L9.12944565,7.4 L7.464,7.39927718 L7.46472282,9.06472282 C7.46472282,9.36295659 7.24713321,9.61036958 6.96204594,9.65686984 L6.86472282,9.66472282 C6.56648906,9.66472282 6.31907607,9.44713321 6.27257581,9.16204594 L6.26472282,9.06472282 L6.264,7.39927718 L4.6,7.4 C4.30176624,7.4 4.05435325,7.18241039 4.00785299,6.89732312 L4,6.8 C4,6.50176624 4.21758961,6.25435325 4.50267688,6.20785299 L4.6,6.2 L6.264,6.19927718 L6.26472282,4.53527718 C6.26472282,4.2701805 6.43664548,4.0452385 6.67507642,3.96586557 L6.76739971,3.94313016 L6.86472282,3.93527718 Z"
      ></path>
    </g>
  </svg>
);

export const SaveFileIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 18, ...props }) => (
  <svg viewBox="0 0 18 18" version="1.1" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g id="save-file" stroke="none" fill="currentColor">
      <path
        fillRule="nonzero"
        d="M11.064 9.1l2.645 2.595.03-.029.848.849-3.523 3.323-.848-.848 1.994-1.883H7.5v-1.2h4.712l-1.996-1.958.848-.849zM9.356.3L13.7 3.71V7.9h-1.2l-.001-2.633H8.5V1.5L3.1 1.5a.4.4 0 0 0-.392.32L2.7 1.9v12a.4.4 0 0 0 .32.392l.08.008h3.418v1.2H3.1a1.6 1.6 0 0 1-1.593-1.454L1.5 13.9v-12A1.6 1.6 0 0 1 2.954.307L3.1.3h6.256zM9.7 2.095v1.973l2.51-.001L9.7 2.095z"
      ></path>
    </g>
  </svg>
);

export const OpenFileIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 18, ...props }) => (
  <svg viewBox="0 0 18 18" version="1.1" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g id="save-file" stroke="currentColor" fill="none">
      <path
        d="m9.257 6.351.183.183H15.819c.34 0 .727.182 1.051.506.323.323.505.708.505 1.05v5.819c0 .316-.183.7-.52 1.035-.337.338-.723.522-1.037.522H4.182c-.352 0-.74-.181-1.058-.5-.318-.318-.499-.705-.499-1.057V5.182c0-.351.181-.736.5-1.054.32-.321.71-.503 1.057-.503H6.53l2.726 2.726Z"
        strokeWidth="1.25"
      />
    </g>
  </svg>
);

export const BackgroundColorIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className="background-color-icon"
    width={size}
    height={size}
    {...props}
  >
    <g transform="translate(1 1)" fillRule="evenodd" fill="#000" stroke="none">
      <circle fillOpacity=".04" r="11" cy="11" cx="11"></circle>
      <path
        d="M17 20.221V17h3.221A11.06 11.06 0 0 1 17 20.221zm-12 0A11.06 11.06 0 0 1 1.779 17H5v3.221zM20.221 5H17V1.779A11.06 11.06 0 0 1 20.221 5zM9 .181V1H6.411A10.919 10.919 0 0 1 9 .181zM15.589 1H13V.181c.907.167 1.775.445 2.589.819zM13 21.819V21h2.589c-.814.374-1.682.652-2.589.819zm-4 0A10.919 10.919 0 0 1 6.411 21H9v.819zm-8-6.23A10.919 10.919 0 0 1 .181 13H1v2.589zm0-9.178V9H.181C.348 8.093.626 7.225 1 6.411zM21.819 9H21V6.411c.374.814.652 1.682.819 2.589zM21 15.589V13h.819A10.919 10.919 0 0 1 21 15.589zM5 1.779V5H1.779A11.06 11.06 0 0 1 5 1.779zM5 13h4v4H5v-4zm8 0h4v4h-4v-4zM5 5h4v4H5V5zm8 0h4v4h-4V5zm0 12v4H9v-4h4zm8-8v4h-4V9h4zm-8 0v4H9V9h4zM5 9v4H1V9h4zm8-8v4H9V1h4z"
        fillOpacity=".12"
      ></path>
    </g>
  </svg>
);

export const NoColorIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 32, ...props }) => (
  <svg viewBox="0 0 32 32" className="no-color-icon" width={size} height={size} {...props}>
    <g
      xmlns="http://www.w3.org/2000/svg"
      fillRule="nonzero"
      fill="currentColor"
      stroke="none"
    >
      <path d="M2 16c0 7.733 6.267 14 14 14s14-6.267 14-14S23.733 2 16 2 2 8.267 2 16zm-1 0C1 7.716 7.714 1 16 1c8.284 0 15 6.714 15 15 0 8.284-6.714 15-15 15-8.284 0-15-6.714-15-15z"></path>
      <path d="M6.354 26.354l-.708-.708 20-20 .708.708z"></path>
    </g>
  </svg>
);

export const Check: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    className="selected-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

export const StrokeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" className="stroke-icon" width={size} height={size} {...props}>
    <g
      xmlns="http://www.w3.org/2000/svg"
      stroke="none"
      fillRule="evenodd"
      fill="#000"
    >
      <path
        d="M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0-4c6.075 0 11 4.925 11 11s-4.925 11-11 11S1 18.075 1 12 5.925 1 12 1z"
        fillRule="nonzero"
        fillOpacity=".04"
      ></path>
      <path
        d="M12 5V1c1.491 0 2.914.297 4.21.835L14.68 5.53A6.979 6.979 0 0 0 12 5zm4.95 2.048l2.828-2.828a11.016 11.016 0 0 1 2.388 3.568l-3.697 1.53a7.01 7.01 0 0 0-1.519-2.27zM19 12h4c0 1.491-.297 2.914-.835 4.21l-3.696-1.53c.342-.826.531-1.73.531-2.68zm-2.05 4.95l2.828 2.828a11.016 11.016 0 0 1-3.567 2.387l-1.532-3.696a7.01 7.01 0 0 0 2.27-1.52zM12 19v4c-1.491 0-2.914-.297-4.21-.835l1.53-3.696c.826.342 1.73.531 2.68.531zm-4.95-2.05l-2.828 2.828a11.016 11.016 0 0 1-2.387-3.567l3.696-1.532a7.01 7.01 0 0 0 1.52 2.27zM5 12H1c0-1.491.297-2.914.835-4.21L5.53 9.32A6.979 6.979 0 0 0 5 12zm2.05-4.95L4.222 4.222a11.016 11.016 0 0 1 3.567-2.387L9.321 5.53a7.01 7.01 0 0 0-2.27 1.52z"
        fillOpacity=".12"
      ></path>
    </g>
  </svg>
);

export const StrokeWhiteIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <g
      xmlns="http://www.w3.org/2000/svg"
      id="icon-border-white"
      stroke="none"
      strokeWidth="1"
      fill="none"
      fillRule="evenodd"
      opacity="0.1"
    >
      <g id="Group">
        <path
          d="M12,22 C17.5228475,22 22,17.5228475 22,12 C22,6.4771525 17.5228475,2 12,2 C6.4771525,2 2,6.4771525 2,12 C2,17.5228475 6.4771525,22 12,22 Z M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z"
          fill="#000000"
          fillRule="nonzero"
        />
        <path
          d="M12,19 C15.8659932,19 19,15.8659932 19,12 C19,8.13400675 15.8659932,5 12,5 C8.13400675,5 5,8.13400675 5,12 C5,15.8659932 8.13400675,19 12,19 Z M12,20 C7.581722,20 4,16.418278 4,12 C4,7.581722 7.581722,4 12,4 C16.418278,4 20,7.581722 20,12 C20,16.418278 16.418278,20 12,20 Z"
          fill="#000000"
          fillRule="nonzero"
        />
      </g>
    </g>
  </svg>
);

export const StrokeStyleNormalIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g transform="translate(0 14)" fillRule="evenodd" fill="none">
      <path d="M-18-19h60v40h-60z"></path>
      <path d="M0 0h24v2H0z" fill="currentColor"></path>
    </g>
  </svg>
);

export const StrokeStyleDashedIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g transform="translate(0 14)" fillRule="evenodd" fill="none">
      <g fill="currentColor">
        <path d="M0 0h6v2H0zM9 0h6v2H9zM18 0h6v2h-6z"></path>
      </g>
    </g>
  </svg>
);

export const StrokeStyleDotedIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g transform="translate(0 14)" fillRule="evenodd" fill="none">
      <g fill="currentColor">
        <rect rx="1" height="2" width="2"></rect>
        <rect rx="1" x="4" height="2" width="2"></rect>
        <rect rx="1" x="8" height="2" width="2"></rect>
        <rect rx="1" x="12" height="2" width="2"></rect>
        <rect rx="1" x="16" height="2" width="2"></rect>
        <rect rx="1" x="20" height="2" width="2"></rect>
      </g>
    </g>
  </svg>
);

export const StrokeStyleDoubleIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g transform="translate(0 12)" fillRule="evenodd" fill="none">
      <path d="M0 0h24v2H0z" fill="currentColor"></path>
      <path d="M0 4h24v2H0z" fill="currentColor"></path>
    </g>
  </svg>
);

export const FontColorIcon: React.FC<{ currentColor?: string }> = ({
  currentColor,
}) => {
  return (
    <svg
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      className="font-color-icon"
    >
      <g
        id="font-color"
        strokeWidth="1"
        fillRule="evenodd"
        stroke="none"
        fill="currentColor"
      >
        <path
          id="secondary-color"
          d="M1.999 15.011h11.998V13.81H1.999z"
          fill={currentColor || '#333333'}
        ></path>
        <path
          d="M6.034 7.59h4.104L8.086 2.297 6.034 7.59zm-.465 1.2l-1.437 3.707H2.845L7.301 1h1.287l-.001.004h.286l4.454 11.492h-1.288L10.603 8.79H5.569z"
          id="A"
        ></path>
      </g>
    </svg>
  );
};

export const UndoIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    {...props}
  >
    <g stroke="none" fill="currentColor">
      <g id="undo-cion" transform="translate(1 1)">
        <path
          d="M3.84 5.825a.6.6 0 0 1 .063.774l-.064.075a.6.6 0 0 1-.774.063l-.074-.063L.176 3.859a.6.6 0 0 1-.064-.775l.064-.074L3.01.176a.6.6 0 0 1 .912.774l-.063.074-1.795 1.794h6.851a5.1 5.1 0 0 1 .216 10.196l-.216.004h-4a.6.6 0 0 1-.097-1.192l.097-.008h4a3.9 3.9 0 0 0 .201-7.795l-.2-.005H2.033l1.805 1.807z"
          id="undo-icon-path"
        ></path>
      </g>
    </g>
  </svg>
);

export const RedoIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    {...props}
  >
    <g stroke="none" fill="currentColor">
      <g id="redo-cion" transform="matrix(-1 0 0 1 15.015 1)">
        <path
          d="M3.84 5.825a.6.6 0 0 1 .063.774l-.064.075a.6.6 0 0 1-.774.063l-.074-.063L.176 3.859a.6.6 0 0 1-.064-.775l.064-.074L3.01.176a.6.6 0 0 1 .912.774l-.063.074-1.795 1.794h6.851a5.1 5.1 0 0 1 .216 10.196l-.216.004h-4a.6.6 0 0 1-.097-1.192l.097-.008h4a3.9 3.9 0 0 0 .201-7.795l-.2-.005H2.033l1.805 1.807z"
          id="redo-icon-path"
        ></path>
      </g>
    </g>
  </svg>
);

export const TrashIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 20, ...props }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" width={size} height={size} {...props}>
    <path
      strokeWidth="1.25"
      d="M3.333 5.833h13.334M8.333 9.167v5M11.667 9.167v5M4.167 5.833l.833 10c0 .92.746 1.667 1.667 1.667h6.666c.92 0 1.667-.746 1.667-1.667l.833-10M7.5 5.833v-2.5c0-.46.373-.833.833-.833h3.334c.46 0 .833.373.833.833v2.5"
    ></path>
  </svg>
);

export const DuplicateIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 20, ...props }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    {...props}
  >
    <g strokeWidth="1.25">
      <path d="M14.375 6.458H8.958a2.5 2.5 0 0 0-2.5 2.5v5.417a2.5 2.5 0 0 0 2.5 2.5h5.417a2.5 2.5 0 0 0 2.5-2.5V8.958a2.5 2.5 0 0 0-2.5-2.5Z"></path>
      <path d="M11.667 3.125c.517 0 .986.21 1.325.55.34.338.55.807.55 1.325v1.458H8.333c-.485 0-.927.185-1.26.487-.343.312-.57.75-.609 1.24l-.005 5.357H5a1.87 1.87 0 0 1-1.326-.55 1.87 1.87 0 0 1-.549-1.325V5c0-.518.21-.987.55-1.326.338-.34.807-.549 1.325-.549h6.667Z"></path>
    </g>
  </svg>
);

export const FeltTipPenIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    <path d="m13.4 2 6.6 6.6-13 13L2 22l.4-5z" />
    <path d="m11 4 7 7" />
  </svg>
);

export const MaskBrushIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 2" />
    <path d="m14.5 7.5 2 2-6.4 6.4-2.6.6.6-2.6z" />
    <path d="m13.2 8.8 2 2" />
  </svg>
);

// 激光笔图标
export const LaserPointerIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    <g transform="rotate(90 10 10)">
      <path clipRule="evenodd" d="m9.644 13.69 7.774-7.773a2.357 2.357 0 0 0-3.334-3.334l-7.773 7.774L8 12l1.643 1.69Z" />
      <path d="m13.25 3.417 3.333 3.333M10 10l2-2M5 15l3-3M2.156 17.894l1-1M5.453 19.029l-.144-1.407M2.377 11.887l.866 1.118M8.354 17.273l-1.194-.758M.953 14.652l1.408.13" />
    </g>
  </svg>
);

// 钢笔工具图标（矢量路径绘制）
export const VectorPenIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    <path d="m12 19 7-7 3 3-7 7-3-3z" />
    <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="m2 2 5 5" />
    <path d="m8.5 8.5 1 1" />
  </svg>
);

// 角点锚点图标 - 控制柄可独立调整
export const AnchorCornerIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* 左侧控制柄线 */}
      <line x1="4" y1="18" x2="12" y2="12" strokeDasharray="2,2" />
      {/* 右侧控制柄线 - 角度不同 */}
      <line x1="12" y1="12" x2="20" y2="8" strokeDasharray="2,2" />
      {/* 左侧控制点 */}
      <circle cx="4" cy="18" r="2" fill="currentColor" />
      {/* 右侧控制点 */}
      <circle cx="20" cy="8" r="2" fill="currentColor" />
      {/* 中心锚点 - 方形表示角点 */}
      <rect x="9.5" y="9.5" width="5" height="5" fill="white" stroke="currentColor" strokeWidth="1.5" />
    </g>
  </svg>
);

// 平滑锚点图标 - 控制柄方向对称但长度可不同
export const AnchorSmoothIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* 左侧控制柄线 - 较短 */}
      <line x1="6" y1="16" x2="12" y2="12" strokeDasharray="2,2" />
      {/* 右侧控制柄线 - 较长，方向对称 */}
      <line x1="12" y1="12" x2="20" y2="6" strokeDasharray="2,2" />
      {/* 左侧控制点 */}
      <circle cx="6" cy="16" r="2" fill="currentColor" />
      {/* 右侧控制点 */}
      <circle cx="20" cy="6" r="2" fill="currentColor" />
      {/* 中心锚点 - 圆形表示平滑 */}
      <circle cx="12" cy="12" r="3" fill="white" stroke="currentColor" strokeWidth="1.5" />
    </g>
  </svg>
);

// 对称锚点图标 - 控制柄完全对称
export const AnchorSymmetricIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* 左侧控制柄线 */}
      <line x1="4" y1="16" x2="12" y2="12" strokeDasharray="2,2" />
      {/* 右侧控制柄线 - 完全对称 */}
      <line x1="12" y1="12" x2="20" y2="8" strokeDasharray="2,2" />
      {/* 左侧控制点 */}
      <circle cx="4" cy="16" r="2" fill="currentColor" />
      {/* 右侧控制点 */}
      <circle cx="20" cy="8" r="2" fill="currentColor" />
      {/* 中心锚点 - 菱形表示对称 */}
      <rect x="9" y="9" width="6" height="6" fill="white" stroke="currentColor" strokeWidth="1.5" transform="rotate(45 12 12)" />
    </g>
  </svg>
);

export const ImageIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    <rect width="18" height="18" x="3" y="3" rx="3" ry="3" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
);

export const ImageUploadIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="1.5" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
    <line x1="16" y1="5" x2="22" y2="5" />
    <line x1="19" y1="2" x2="19" y2="8" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
);

export const MermaidLogoIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);

export const MarkdownLogoIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="M7 15V9l3 3 3-3v6M17 15l2-2-2-2M19 13h-4" />
  </svg>
);

export const LinkIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={size} height={size} {...props}>
    <g stroke="none" fill="currentColor">
      <path
        d="M12.253 4.13h-1.2v-1a2.8 2.8 0 0 0-5.6 0v4a2.8 2.8 0 0 0 2.8 2.8v1.2a4 4 0 0 1-4-4v-4a4 4 0 0 1 8 0v1zm-8 8h1.2v1a2.8 2.8 0 0 0 5.6 0v-4a2.8 2.8 0 0 0-2.8-2.8v-1.2a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0v-1z"
        transform="rotate(46 8.253 8.13)"
      ></path>
    </g>
  </svg>
);

export const SettingsIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" width={size} height={size} {...props}>
    <g strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
    </g>
  </svg>
);

export const VideoFrameIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" version="1.1" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g id="video-frame" stroke="none" fill="currentColor">
      <rect x="1" y="3" width="14" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="3" y="5" width="10" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
      <circle cx="12" cy="6" r="0.8" fill="currentColor"/>
      <path d="M2 14L5 11L7 13L11 9L14 12" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="1" y="14.5" width="14" height="1" rx="0.5" fill="currentColor"/>
      <circle cx="4" cy="15" r="0.8" fill="white" stroke="currentColor" strokeWidth="0.5"/>
    </g>
  </svg>
);

// 素材库图标 - 宫格 + 圆圈风格
export const MediaLibraryIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <circle cx="17" cy="7" r="4" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

export const ViewIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" width={size} height={size} {...props}>
    <g strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </g>
  </svg>
);

export const ThemeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    width={size}
    height={size}
    {...props}
  >
    <g strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 2a10 10 0 0 1 0 20"/>
      <path d="M12 2c-2.5 2.5-4 6-4 10s1.5 7.5 4 10"/>
    </g>
  </svg>
);

export const WeComIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    <path d="M8 12h.01" />
    <path d="M12 12h.01" />
    <path d="M16 12h.01" />
  </svg>
);

export const MoreIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    width={size}
    height={size}
    {...props}
  >
    <g strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" fill="currentColor"/>
      <circle cx="12" cy="5" r="1" fill="currentColor"/>
      <circle cx="12" cy="19" r="1" fill="currentColor"/>
    </g>
  </svg>
);

export const SplitImageIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none" width={size} height={size} {...props}>
    {/* 外框 */}
    <rect x="1" y="1" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
    {/* 垂直分割线 */}
    <line x1="5.5" y1="1" x2="5.5" y2="15" stroke="currentColor" strokeWidth="1" strokeDasharray="2,1"/>
    <line x1="10.5" y1="1" x2="10.5" y2="15" stroke="currentColor" strokeWidth="1" strokeDasharray="2,1"/>
    {/* 水平分割线 */}
    <line x1="1" y1="5.5" x2="15" y2="5.5" stroke="currentColor" strokeWidth="1" strokeDasharray="2,1"/>
    <line x1="1" y1="10.5" x2="15" y2="10.5" stroke="currentColor" strokeWidth="1" strokeDasharray="2,1"/>
    {/* 分散箭头表示拆开 */}
    <path d="M3 3L2 2M13 3L14 2M3 13L2 14M13 13L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

export const DownloadIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 20, ...props }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      {/* 向下箭头 */}
      <path d="M10 3.333v9.167" />
      <path d="M6.667 9.167L10 12.5l3.333-3.333" />
      {/* 底部托盘 */}
      <path d="M3.333 12.5v2.5c0 .92.747 1.667 1.667 1.667h10c.92 0 1.667-.747 1.667-1.667v-2.5" />
    </g>
  </svg>
);

export const MergeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 20, ...props }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      {/* 左上角小框 */}
      <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
      {/* 右上角小框 */}
      <rect x="12.5" y="2.5" width="5" height="5" rx="1" />
      {/* 左下角小框 */}
      <rect x="2.5" y="12.5" width="5" height="5" rx="1" />
      {/* 中心合并目标框 */}
      <rect x="9" y="9" width="8" height="8" rx="1.5" strokeWidth="1.5" />
      {/* 合并箭头 */}
      <path d="M7.5 5L9 6.5" />
      <path d="M12.5 5L11 6.5" />
      <path d="M5 7.5L6.5 9" />
    </g>
  </svg>
);

export const VideoMergeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 20, ...props }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      {/* 左侧视频片段 */}
      <rect x="1.5" y="5" width="5" height="4" rx="0.5" />
      <path d="M5.5 6.5L7 7L5.5 7.5" fill="currentColor" stroke="none" />
      {/* 右侧视频片段 */}
      <rect x="1.5" y="11" width="5" height="4" rx="0.5" />
      <path d="M5.5 12.5L7 13L5.5 13.5" fill="currentColor" stroke="none" />
      {/* 合并箭头 */}
      <path d="M8 7L10 10L8 13" />
      {/* 合成后的视频 */}
      <rect x="11" y="4" width="7.5" height="12" rx="1" strokeWidth="1.5" />
      {/* 播放按钮 */}
      <path d="M13.5 10L16.5 10" strokeWidth="1.5" />
      <path d="M15 8.5L15 11.5" strokeWidth="1.5" />
    </g>
  </svg>
);

// 图片编辑图标（裁剪+滤镜）
export const ImageEditIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 20, ...props }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      {/* 图片边框 */}
      <rect x="2" y="4" width="12" height="12" rx="1.5" />
      {/* 裁剪角标记 */}
      <path d="M5 4V2" />
      <path d="M2 7H4" />
      <path d="M11 16V18" />
      <path d="M14 13H16" />
      {/* 铅笔/编辑 */}
      <path d="M14.5 3.5L17.5 6.5" />
      <path d="M16 5L18 3L15.5 0.5L13.5 2.5L16 5Z" fill="currentColor" stroke="none" transform="translate(-2, 4)" />
      <path d="M11.5 7L15.5 11L10 12L11 10.5L11.5 7Z" />
    </g>
  </svg>
);

// ============ 文本特效图标 ============

// 字体选择图标
export const FontFamilyIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12.5L8 3L13 12.5" />
      <path d="M4.5 10H11.5" />
      <path d="M2 14.5H6" />
      <path d="M10 14.5H14" />
    </g>
  </svg>
);

// 阴影效果图标
export const ShadowEffectIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="9" height="9" rx="1.5" stroke="currentColor" fill="none" />
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" fill="none" opacity="0.4" />
    </g>
  </svg>
);

// 渐变图标
export const GradientIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <defs>
      <linearGradient id="gradientIconFill" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FFD700" />
        <stop offset="100%" stopColor="#FF4500" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="12" height="12" rx="2" fill="url(#gradientIconFill)" />
    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
  </svg>
);

// 图层图标
export const LayerIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L14 5.5L8 9L2 5.5L8 2Z" />
      <path d="M2 8L8 11.5L14 8" />
      <path d="M2 10.5L8 14L14 10.5" />
    </g>
  </svg>
);

// 置顶图标
export const BringToFrontIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="2" y="5" width="6" height="6" rx="1" fill="none" />
      <rect x="8" y="9" width="6" height="6" rx="1" fill="none" />
      <path d="M8 4V1M8 1L6 3M8 1L10 3" />
    </g>
  </svg>
);

// 上移一层图标
export const BringForwardIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="8" height="5" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="4" y="9" width="8" height="5" rx="1" fill="none" />
      <path d="M8 7V4M8 4L6 6M8 4L10 6" />
    </g>
  </svg>
);

// 下移一层图标
export const SendBackwardIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="8" height="5" rx="1" fill="none" />
      <rect x="4" y="9" width="8" height="5" rx="1" fill="currentColor" opacity="0.3" />
      <path d="M8 9V12M8 12L6 10M8 12L10 10" />
    </g>
  </svg>
);

// 置底图标
export const SendToBackIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1" width="6" height="6" rx="1" fill="none" />
      <rect x="8" y="5" width="6" height="6" rx="1" fill="none" />
      <rect x="5" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.3" />
      <path d="M8 12V15M8 15L6 13M8 15L10 13" />
    </g>
  </svg>
);

// 属性设置图标
export const PropertySettingsIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" fill="none" />
      <circle cx="5" cy="4" r="1.5" fill="currentColor" />
      <circle cx="11" cy="8" r="1.5" fill="currentColor" />
      <circle cx="7" cy="12" r="1.5" fill="currentColor" />
    </g>
  </svg>
);

// 备份恢复图标
export const BackupRestoreIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width={size} height={size} {...props}>
    <g strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
      <path d="M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
      <circle cx="12" cy="12" r="3" />
    </g>
  </svg>
);

// 锁定/解锁图标（用于等比缩放）
export const LockIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const UnlockIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

// 提示词图标
export const PromptIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8" />
    <path d="M8 13h6" />
  </svg>
);

// 姿态/人像图标
export const PoseIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <circle cx="12" cy="7" r="4" />
    <path d="M5 22v-3a7 7 0 0 1 14 0v3" />
  </svg>
);

// 聊天图标
export const MessageIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.38 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.38 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

// 批量/多选图标
export const BatchIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <rect x="2" y="2" width="8" height="8" rx="2" />
    <rect x="14" y="2" width="8" height="8" rx="2" />
    <rect x="2" y="14" width="8" height="8" rx="2" />
    <rect x="14" y="14" width="8" height="8" rx="2" />
  </svg>
);

// 插入到画布图标 - 画框 + 中心加号
export const InsertToCanvasIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    {/* 画框 */}
    <rect x="3" y="3" width="18" height="18" rx="2" />
    {/* 中心加号 */}
    <path d="M12 8v8" />
    <path d="M8 12h8" />
  </svg>
);

// 调试日志图标 - 控制台/终端风格
export const DebugLogIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} {...props}>
    {/* 终端窗口外框 */}
    <rect x="2" y="3" width="20" height="18" rx="2" />
    {/* 顶部栏 */}
    <line x1="2" y1="7" x2="22" y2="7" />
    {/* 顶部三个点 */}
    <circle cx="5.5" cy="5" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="5" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="11.5" cy="5" r="0.8" fill="currentColor" stroke="none" />
    {/* 终端提示符和代码行 */}
    <path d="M5 11l2 2-2 2" />
    <line x1="9" y1="15" x2="14" y2="15" />
    <line x1="9" y1="18" x2="18" y2="18" opacity="0.5" />
  </svg>
);

export const CommandPaletteIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    {/* ⌘ Command symbol */}
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  </svg>
);

export const BookOpenIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

// 对齐图标 - 主图标（带下拉箭头）
export const AlignmentIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="2" y2="14" />
      <rect x="4" y="3" width="10" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="4" y="9" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 左对齐图标
export const AlignLeftIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="2" y2="14" />
      <rect x="4" y="3" width="10" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="4" y="9" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 水平居中图标
export const AlignCenterIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="2" x2="8" y2="14" />
      <rect x="2" y="3" width="12" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="4" y="9" width="8" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 右对齐图标
export const AlignRightIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="14" y1="2" x2="14" y2="14" />
      <rect x="2" y="3" width="10" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="6" y="9" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 顶部对齐图标
export const AlignTopIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="14" y2="2" />
      <rect x="3" y="4" width="4" height="10" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="9" y="4" width="4" height="6" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 垂直居中图标
export const AlignMiddleIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="8" x2="14" y2="8" />
      <rect x="3" y="2" width="4" height="12" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="9" y="4" width="4" height="8" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 底部对齐图标
export const AlignBottomIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="14" x2="14" y2="14" />
      <rect x="3" y="2" width="4" height="10" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="9" y="6" width="4" height="6" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 间距分布图标 - 主图标
export const DistributeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="2" y2="14" />
      <line x1="14" y1="2" x2="14" y2="14" />
      <rect x="5" y="4" width="6" height="8" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 水平间距图标
export const DistributeHorizontalIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="2" y2="14" />
      <line x1="14" y1="2" x2="14" y2="14" />
      <rect x="5" y="4" width="6" height="8" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 垂直间距图标
export const DistributeVerticalIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="14" y2="2" />
      <line x1="2" y1="14" x2="14" y2="14" />
      <rect x="4" y="5" width="8" height="6" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 自动排列图标
export const AutoArrangeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="9" y="2" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="2" y="9" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.3" />
      <rect x="9" y="9" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 布尔运算图标 - 主图标（合并）
export const BooleanIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" opacity="0.2" />
    </g>
  </svg>
);

// 合并图标 (Union)
export const BooleanUnionIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3h3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3H3a1 1 0 0 1-1-1V3z" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 减去图标 (Subtract)
export const BooleanSubtractIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="6" y="6" width="8" height="8" rx="1" fill="none" strokeDasharray="2 1" />
    </g>
  </svg>
);

// 相交图标 (Intersect)
export const BooleanIntersectIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="8" rx="1" fill="none" />
      <rect x="6" y="6" width="8" height="8" rx="1" fill="none" />
      <rect x="6" y="6" width="4" height="4" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
);

// 排除图标 (Exclude)
export const BooleanExcludeIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3h-4v4H3a1 1 0 0 1-1-1V3z" fill="currentColor" opacity="0.3" />
      <path d="M10 6v3H7a1 1 0 0 0-1 1v3h7a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-3z" fill="currentColor" opacity="0.3" />
      <rect x="2" y="2" width="8" height="8" rx="1" fill="none" />
      <rect x="6" y="6" width="8" height="8" rx="1" fill="none" />
    </g>
  </svg>
);

// 扁平化图标 (Flatten)
export const BooleanFlattenIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <g strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v4M8 10v4M2 8h4M10 8h4" />
      <path d="M5 5l2 2M9 9l2 2M5 11l2-2M9 5l2 2" opacity="0.5" />
    </g>
  </svg>
);

// 云端同步图标
export const CloudIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 18, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);

// 清除失效链接图标 - 断开的链接 + 删除标记
export const CleanBrokenLinksIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 18, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    {/* 断开的链接 - 左半部分 */}
    <path d="M9 17H7A5 5 0 0 1 7 7" />
    <path d="M7 12h4" />
    {/* 断开的链接 - 右半部分 */}
    <path d="M15 7h2a5 5 0 0 1 4 8" />
    <path d="M13 12h4" />
    {/* 删除标记 */}
    <circle cx="18" cy="18" r="4" fill="#ff4d4f" stroke="#ff4d4f" />
    <path d="M16 18h4" stroke="white" strokeWidth="2" />
  </svg>
);

// Frame 容器图标
export const FrameContainerIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 16, ...props }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...props}>
    <rect x="1.5" y="3.5" width="13" height="11" rx="1" strokeWidth="1.2" strokeDasharray="3 2" />
    <text x="3" y="3" fontSize="4" fill="currentColor" stroke="none" fontFamily="system-ui" fontWeight="500">F</text>
  </svg>
);

// 套索选择图标
export const LassoIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    {...props}
  >
    <path d="M12 4C7.58 4 4 6.69 4 10c0 2.05 1.3 3.86 3.3 5.04" />
    <path d="M20 10c0-3.31-3.58-6-8-6" strokeDasharray="3 2" />
    <circle cx="12" cy="14" r="3" />
    <path d="M12 17v4" />
    <path d="M10 21h4" />
  </svg>
);
