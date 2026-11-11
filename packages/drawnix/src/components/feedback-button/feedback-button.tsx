/**
 * FeedbackButton Component
 *
 * Shows the feedback community QR code and OpenTu X profile in one popover.
 */

import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';
import { useBoard } from '@plait-board/react-board';
import { PlaitBoard } from '@plait/core';
import { Z_INDEX } from '../../constants/z-index';
import { WeComIcon } from '../icons';
import { ToolButton } from '../tool-button';
import './feedback-button.scss';

const QR_CODE_URL = 'https://tuziai.oss-cn-shenzhen.aliyuncs.com/aitu/AiTu.png';

export const FeedbackButton: React.FC = () => {
  const board = useBoard();
  const { t } = useI18n();
  const container = PlaitBoard.getBoardContainer(board);
  const [open, setOpen] = useState(false);

  // 预加载图片
  useEffect(() => {
    const img1 = new Image();
    img1.src = QR_CODE_URL;
  }, []);

  return (
    <Popover placement="right-end" sideOffset={12} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolButton
          type="icon"
          icon={<WeComIcon />}
          aria-label={t('resources.community')}
          tooltip={t('resources.community')}
          tooltipPlacement="right"
          selected={open}
          visible={true}
          data-testid="toolbar-feedback"
          data-track="toolbar_click_feedback"
          onPointerDown={(e) => {
            e.event.stopPropagation();
          }}
          onClick={() => setOpen(!open)}
        />
      </PopoverTrigger>
      <PopoverContent container={container} style={{ zIndex: Z_INDEX.POPOVER_FEEDBACK }}>
        <div className="feedback-qrcode-content">
          <div className="feedback-qrcode-grid">
            <div className="feedback-qrcode-item">
              <img
                src={QR_CODE_URL}
                alt="用户反馈群二维码"
                className="feedback-qrcode-image"
              />
              <div className="feedback-qrcode-text">用户反馈群</div>
            </div>
          </div>
          <a
            className="feedback-social-link"
            href="https://x.com/shuidiyuAI"
            target="_blank"
            rel="noopener noreferrer"
            data-track="toolbar_click_follow_x"
          >
            <span className="feedback-social-link__icon" aria-hidden="true">X</span>
            <span className="feedback-social-link__text">
              <strong>{t('resources.follow')}</strong>
              <span>{t('resources.followDescription')}</span>
            </span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
};
