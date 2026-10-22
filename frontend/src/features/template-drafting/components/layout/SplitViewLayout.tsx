/**
 * Template Drafting Component - Split View Layout
 * Main layout with left preview and right panel
 */

import React from 'react';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';

export const SplitViewLayout: React.FC = () => {
    return (
        <div className="split-view">
            <LeftPanel />
            <RightPanel />
        </div>
    );
};
